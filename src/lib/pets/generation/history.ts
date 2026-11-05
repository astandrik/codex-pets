import {baseRepairProgressSchema} from "@/lib/pets/generation/base-repair-progress";
import {z} from "zod";
import {animationRepairProgressSchema} from "@/lib/pets/generation/animation-repair-progress";
import {groupGenerationVersions, type HistoryVersionKind} from './history-families';

export const HISTORY_PREFIX = "pets-generation-history-v1:";
export const HISTORY_V2_PREFIX = "pets-generation-history-v2:";
export const HISTORY_FACT_PREFIX = "pets-generation-history-fact-v1:";
export const HISTORY_FAMILY_LIMIT = 50;
const ID = /^[a-f0-9]{64}$/;
const DAY = 86_400_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const EXPIRED_RETENTION_MS = 7 * DAY;
const CLEANUP_INTERVAL_MS = 5 * 60_000;
const cleanups = new WeakMap<ReadableHistoryStorage,{checkedAt:number}>();
type ReadableHistoryStorage = Pick<Storage, 'length' | 'key' | 'getItem'>;
type PrunableHistoryStorage = ReadableHistoryStorage & Pick<Storage, 'removeItem'>;
type HistoryStorage = PrunableHistoryStorage & Pick<Storage, 'setItem'>;
const identity = z.string().regex(ID);
const kindSchema = z.enum(['initial','base-refinement','base-retry','continuation','animation-revision']);
const entrySchema = z.object({
  generationId: identity,
  savedAt: z.number().finite().positive(),
  expiresAt: z.number().finite().positive(),
  familyId: identity.optional(),
  parentGenerationId: identity.optional(),
  createdAt: z.number().finite().positive().optional(),
  kind: kindSchema.optional(),
});
const legacySchema = entrySchema.pick({generationId:true,savedAt:true,expiresAt:true});
const factSchema = entrySchema.omit({savedAt:true}).refine(value=>value.createdAt!==undefined||value.parentGenerationId!==undefined);
export type GenerationHistoryEntry = z.infer<typeof entrySchema>;
type HistoryFact = z.infer<typeof factSchema>;
export type HistoryGenerationReference = {generationId: string; expiresAt: string; createdAt?: string; baseRetrySourceId?: string; continuation?: {sourceGenerationId: string; mode: string}; animationRevision?: {sourceGenerationId?: string}};
export function isGenerationHistoryKey(key: string): boolean {
  return key.startsWith(HISTORY_PREFIX)||key.startsWith(HISTORY_V2_PREFIX)||key.startsWith(HISTORY_FACT_PREFIX);
}
function keyId(key: string): string | null {
  const prefix=key.startsWith(HISTORY_V2_PREFIX)?HISTORY_V2_PREFIX:key.startsWith(HISTORY_PREFIX)?HISTORY_PREFIX:null;
  return prefix&&ID.test(key.slice(prefix.length))?key.slice(prefix.length):null;
}
function parseEntry(raw:string|null,key:string,now:number):GenerationHistoryEntry|null {
  if(!raw||raw.length>2048)return null;
  let value:unknown;
  try {value=JSON.parse(raw);} catch {return null;}
  if(key.startsWith(HISTORY_V2_PREFIX)&&(!value||typeof value!=="object"||!("version" in value)||value.version!==2))return null;
  const parsed=(key.startsWith(HISTORY_V2_PREFIX)?entrySchema:legacySchema).safeParse(value);
  if(!parsed.success)return null;
  const entry:GenerationHistoryEntry=parsed.data;
  if(entry.generationId!==keyId(key)||entry.savedAt>now+CLOCK_SKEW_MS||entry.expiresAt>entry.savedAt+DAY+CLOCK_SKEW_MS||(entry.createdAt!==undefined&&entry.createdAt>now+CLOCK_SKEW_MS))return null;
  return entry;
}
function factKey(fact:HistoryFact):string {
  return HISTORY_FACT_PREFIX+[fact.generationId,fact.createdAt??'',fact.parentGenerationId??'',fact.familyId??'',fact.kind??'',fact.expiresAt].join(':');
}
function parseFact(raw:string|null,key:string,now:number):HistoryFact|null {
  if(!raw||raw.length>2048)return null;
  let value:unknown;
  try {value=JSON.parse(raw);} catch {return null;}
  const parsed=factSchema.safeParse(value);
  if(!parsed.success)return null;
  const fact=parsed.data;
  return factKey(fact)===key&&fact.expiresAt<=now+DAY+CLOCK_SKEW_MS&&(fact.createdAt===undefined||fact.createdAt<=now+CLOCK_SKEW_MS)?fact:null;
}
function writeFact(storage:Pick<Storage,'getItem'|'setItem'>,fact:HistoryFact) {
  const key=factKey(fact);
  // Distinct observations have distinct keys; cleanup cannot overwrite a newer relation.
  if(storage.getItem(key)===null)storage.setItem(key,JSON.stringify(fact));
}
function writeEntryIfMissing(storage:Pick<Storage,'getItem'|'setItem'>,entry:GenerationHistoryEntry,now:number) {
  const key=HISTORY_V2_PREFIX+entry.generationId;
  if(!parseEntry(storage.getItem(key),key,now))storage.setItem(key,JSON.stringify({version:2,...entry}));
}
function scanGenerationHistory(now:number,storage:ReadableHistoryStorage) {
  const keys=Array.from({length:storage.length},(_,index)=>storage.key(index)).filter((key):key is string=>key!==null&&isGenerationHistoryKey(key));
  const records:Array<{key:string;raw:string;entry:GenerationHistoryEntry}>=[];
  const facts:Array<{key:string;raw:string;fact:HistoryFact}>=[];
  const byId=new Map<string,GenerationHistoryEntry>();
  keys.sort((a,b)=>Number(a.startsWith(HISTORY_V2_PREFIX))-Number(b.startsWith(HISTORY_V2_PREFIX)));
  for(const key of keys){
    const raw=storage.getItem(key);
    if(key.startsWith(HISTORY_FACT_PREFIX)){
      const fact=parseFact(raw,key,now);
      if(fact&&raw)facts.push({key,raw,fact});
      continue;
    }
    const entry=parseEntry(raw,key,now);
    if(!entry||!raw)continue;
    records.push({key,raw,entry});
    const previous=byId.get(entry.generationId);
    byId.set(entry.generationId,{...previous,...entry,savedAt:Math.min(previous?.savedAt??entry.savedAt,entry.savedAt),expiresAt:Math.min(previous?.expiresAt??entry.expiresAt,entry.expiresAt)});
  }
  const factsById=new Map<string,HistoryFact[]>();
  for(const {fact} of facts){const list=factsById.get(fact.generationId)??[];list.push(fact);factsById.set(fact.generationId,list);}
  const nodes=new Map(byId);
  for(const [id,observations] of factsById){
    const base=byId.get(id);
    const parents=observations.filter(fact=>fact.parentGenerationId!==undefined);
    const parentIds=new Set(parents.map(fact=>fact.parentGenerationId));
    const parent=base?.parentGenerationId?undefined:parentIds.size===1?parents[0]:undefined;
    const created=observations.flatMap(fact=>fact.createdAt===undefined?[]:[fact.createdAt]);
    const expiresAt=Math.min(base?.expiresAt??Infinity,...observations.map(fact=>fact.expiresAt));
    nodes.set(id,{
      ...(base??{generationId:id,savedAt:Math.min(...created,expiresAt),expiresAt}),
      expiresAt,
      ...(base?.createdAt===undefined&&created.length?{createdAt:Math.min(...created)}:{}),
      ...(parent?{parentGenerationId:parent.parentGenerationId,familyId:parent.familyId??parent.parentGenerationId,kind:parent.kind}:{}),
    });
  }
  const roots=new Map(groupGenerationVersions([...nodes.values()]).flatMap(group=>group.versions.map(entry=>[entry.generationId,group.familyId] as const)));
  const allEntries=[...byId.values()].filter(entry=>entry.expiresAt+EXPIRED_RETENTION_MS>now).map(entry=>({...nodes.get(entry.generationId)!,familyId:roots.get(entry.generationId)!})).filter(entry=>entry.expiresAt+EXPIRED_RETENTION_MS>now);
  const groups=groupGenerationVersions(allEntries);
  return {records,facts,nodes,allEntries:groups.flatMap(group=>group.versions),entries:groups.slice(0,HISTORY_FAMILY_LIMIT).flatMap(group=>group.versions)};
}
export function readGenerationHistory(now=Date.now(),storage?:ReadableHistoryStorage):{available:boolean;entries:GenerationHistoryEntry[]} {
  try {return {available:true,entries:scanGenerationHistory(now,storage??window.localStorage).entries};} catch {return {available:false,entries:[]};}
}
// The poller needs overflow candidates until their server ancestry is known.
export function readGenerationHistoryForReconciliation(now=Date.now(),storage?:ReadableHistoryStorage):ReturnType<typeof readGenerationHistory> {
  try {return {available:true,entries:scanGenerationHistory(now,storage??window.localStorage).allEntries};} catch {return {available:false,entries:[]};}
}
export function pruneGenerationHistory(now=Date.now(),storage?:PrunableHistoryStorage):boolean {
  try {
    const target=storage??window.localStorage,snapshot=scanGenerationHistory(now,target);
    const needed=new Set<string>();
    for(const entry of snapshot.allEntries){
      let id:string|undefined=entry.generationId;
      while(id&&!needed.has(id)){needed.add(id);id=snapshot.nodes.get(id)?.parentGenerationId;}
    }
    for(const record of snapshot.records){
      const {entry,key,raw}=record;
      if(entry.expiresAt+EXPIRED_RETENTION_MS>now){
        if(key.startsWith(HISTORY_PREFIX)&&'setItem' in target&&typeof target.setItem==='function'){
          try {
            writeEntryIfMissing(target as HistoryStorage,{...entry,familyId:entry.generationId},now);
            const copied=parseEntry(target.getItem(HISTORY_V2_PREFIX+entry.generationId),HISTORY_V2_PREFIX+entry.generationId,now);
            if(copied&&copied.savedAt<=entry.savedAt&&copied.expiresAt<=entry.expiresAt&&target.getItem(key)===raw)target.removeItem(key);
          } catch {/* Keep the legacy record until a copy is safely available. */}
        }
        continue;
      }
      // Preserve only ancestry metadata while a retained descendant still needs it.
      if(needed.has(entry.generationId)&&entry.parentGenerationId){
        if(!('setItem' in target)||typeof target.setItem!=='function')continue;
        try {writeFact(target as HistoryStorage,{generationId:entry.generationId,expiresAt:entry.expiresAt,parentGenerationId:entry.parentGenerationId,familyId:entry.familyId,kind:entry.kind});} catch {continue;}
      }
      try {if(target.getItem(key)===raw)target.removeItem(key);} catch {/* Best effort cleanup. */}
    }
    for(const {key,raw,fact} of snapshot.facts){
      if(!needed.has(fact.generationId)&&fact.expiresAt+EXPIRED_RETENTION_MS<=now){try {if(target.getItem(key)===raw)target.removeItem(key);} catch {/* Best effort cleanup. */}}
    }
    cleanups.set(target,{checkedAt:now});
    return true;
  } catch {return false;}
}
export function rememberGeneration(generationId:string,expiresAt:string,now=Date.now(),storage?:HistoryStorage):boolean {
  return rememberGenerationVersion({generationId,expiresAt},undefined,now,storage);
}
export function historyParent(generation:HistoryGenerationReference):{generationId:string;kind:HistoryVersionKind}|undefined {
  const candidates:Array<{generationId:string;kind:HistoryVersionKind}>=[];
  if(generation.baseRetrySourceId)candidates.push({generationId:generation.baseRetrySourceId,kind:'base-retry'});
  if(generation.continuation?.mode==='regenerate')candidates.push({generationId:generation.continuation.sourceGenerationId,kind:'continuation'});
  if(generation.animationRevision?.sourceGenerationId)candidates.push({generationId:generation.animationRevision.sourceGenerationId,kind:'animation-revision'});
  const valid=candidates.filter(x=>ID.test(x.generationId)&&x.generationId!==generation.generationId);
  return new Set(valid.map(x=>x.generationId)).size===1?valid[0]:undefined;
}
export function rememberGenerationVersion(input:unknown,source?:{generationId:string;kind:HistoryVersionKind},now=Date.now(),storage?:HistoryStorage):boolean {
  return saveGenerationVersion(input,source,now,storage,true);
}
function saveGenerationVersion(input:unknown,source:{generationId:string;kind:HistoryVersionKind}|undefined,now:number,storage:HistoryStorage|undefined,allowQuotaRetry:boolean):boolean {
  try {
    const parsed=historyGenerationSchema.pick({generationId:true,expiresAt:true,createdAt:true,baseRetrySourceId:true,continuation:true,animationRevision:true}).safeParse(input);
    if(!parsed.success)return false;
    const generation=parsed.data,expiresAt=Date.parse(generation.expiresAt),id=generation.generationId;
    if(expiresAt<=now||expiresAt>now+DAY+CLOCK_SKEW_MS)return false;
    const target=storage??window.localStorage;
    const previous=parseEntry(target.getItem(HISTORY_V2_PREFIX+id),HISTORY_V2_PREFIX+id,now)??parseEntry(target.getItem(HISTORY_PREFIX+id),HISTORY_PREFIX+id,now);
    const proposed=source??historyParent(generation);
    const parent=proposed&&ID.test(proposed.generationId)&&proposed.generationId!==id&&(!previous?.parentGenerationId||previous.parentGenerationId===proposed.generationId)?proposed:undefined;
    const created=generation.createdAt===undefined?undefined:Date.parse(generation.createdAt);
    const createdAt=previous?.createdAt??(created!==undefined&&created>0&&created<=now+CLOCK_SKEW_MS?created:undefined);
    const deadline=Math.min(previous?.expiresAt??expiresAt,expiresAt);
    if(createdAt!==undefined)writeFact(target,{generationId:id,expiresAt:deadline,createdAt});
    if(parent)writeFact(target,{generationId:id,expiresAt:deadline,parentGenerationId:parent.generationId,familyId:previous?.parentGenerationId?previous.familyId:parent.generationId,kind:parent.kind});
    writeEntryIfMissing(target,{generationId:id,savedAt:previous?.savedAt??now,expiresAt:deadline,familyId:previous?.familyId??parent?.generationId??id,...(createdAt!==undefined?{createdAt}:{}),...(previous?.parentGenerationId?{parentGenerationId:previous.parentGenerationId,kind:previous.kind}:parent?{parentGenerationId:parent.generationId,kind:parent.kind}:{})},now);
    const lastCleanup=cleanups.get(target)?.checkedAt;
    if(lastCleanup===undefined||now<lastCleanup||now-lastCleanup>=CLEANUP_INTERVAL_MS)pruneGenerationHistory(now,target);
    return true;
  } catch(cause) {
    if(allowQuotaRetry&&typeof cause==='object'&&cause!==null&&'name' in cause&&cause.name==='QuotaExceededError'){
      try {
        const target=storage??window.localStorage;
        if(pruneGenerationHistory(now,target))return saveGenerationVersion(input,source,now,target,false);
      } catch {/* Preserve the caller's pending request when storage stays unavailable. */}
    }
    return false;
  }
}
export function notifyGenerationHistory(storage?:Pick<Storage,'setItem'>):boolean {
  try {(storage??window.localStorage).setItem(HISTORY_PREFIX+'refresh',crypto.randomUUID());return true;} catch {return false;}
}

const historyGenerationSchema = z.object({
  generationId: z.string().regex(ID),
  createdAt: z.iso.datetime().optional(),
  baseRetrySourceId: z.string().regex(ID).optional(),
  status: z.enum(["queued", "generating", "awaiting_confirmation", "processing", "completed", "failed"]),
  expiresAt: z.iso.datetime(),
  progress: z.object({
    completedSteps: z.number().int().min(0).max(12), totalSteps: z.number().int().min(1).max(12),
  }).refine((value) => value.completedSteps <= value.totalSteps),
  canContinue: z.boolean().optional(),
  baseUrl: z.string().optional(),
  animationRepair: animationRepairProgressSchema.optional(),
  baseRepair: baseRepairProgressSchema.optional(),
  continuation: z.object({sourceGenerationId:z.string().regex(ID),mode:z.enum(["rebuild","regenerate"])}).optional(),
  pet: z.object({ displayName: z.string().min(1).max(80) }).optional(),
  animationRevision: z.object({sourceGenerationId: z.string().regex(ID).optional(), acceptedAt: z.number().optional()}).optional(),
  error: z.object({ code: z.string().regex(/^[a-z_]{1,64}$/) }).optional(),
});
export type HistoryGeneration = z.infer<typeof historyGenerationSchema>;

export function parseHistoryGeneration(value: unknown, generationId: string): HistoryGeneration | null {
  const result = historyGenerationSchema.safeParse(value);
  return result.success && result.data.generationId === generationId ? result.data : null;
}
