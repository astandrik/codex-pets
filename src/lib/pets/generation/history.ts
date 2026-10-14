import {z} from "zod";

export const HISTORY_PREFIX = "pets-generation-history-v1:";
const ID = /^[a-f0-9]{64}$/;
const DAY = 86_400_000;
const MAX_ENTRIES = 50;
type HistoryStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
const entrySchema = z.object({generationId:z.string().regex(ID), savedAt:z.number().finite().positive(), expiresAt:z.number().finite().positive()});
export type GenerationHistoryEntry = z.infer<typeof entrySchema>;

export function readGenerationHistory(now=Date.now(), storage?:HistoryStorage): {available:boolean; entries:GenerationHistoryEntry[]} {
  try {
    const target=storage??window.localStorage;
    const keys=Array.from({length:target.length},(_,index)=>target.key(index)).filter((key):key is string=>key!==null&&key.startsWith(HISTORY_PREFIX)&&ID.test(key.slice(HISTORY_PREFIX.length)));
    const entries:GenerationHistoryEntry[]=[];
    for(const key of keys) {
      const raw=target.getItem(key);if(!raw||raw.length>1024)continue;
      let value:unknown;try{value=JSON.parse(raw);}catch{continue;}
      const parsed=entrySchema.safeParse(value);if(!parsed.success)continue;
      const entry=parsed.data;
      if(entry.generationId!==key.slice(HISTORY_PREFIX.length)||entry.savedAt>now+300000||entry.expiresAt>entry.savedAt+DAY+300000)continue;
      if(entry.expiresAt+7*DAY<=now){target.removeItem(key);continue;}
      entries.push(entry);
    }
    entries.sort((a,b)=>b.savedAt-a.savedAt||a.generationId.localeCompare(b.generationId));
    for(const entry of entries.slice(MAX_ENTRIES))target.removeItem(HISTORY_PREFIX+entry.generationId);
    return {available:true,entries:entries.slice(0,MAX_ENTRIES)};
  } catch {return {available:false,entries:[]};}
}

export function rememberGeneration(generationId:string, expiresAt:string, now=Date.now(), storage?:HistoryStorage):boolean {
  try {
    const expires=Date.parse(expiresAt);
    if(!ID.test(generationId)||!Number.isFinite(expires)||expires<=now||expires>now+DAY+300000)return false;
    const target=storage??window.localStorage;
    const history=readGenerationHistory(now,target);if(!history.available)return false;
    const previous=history.entries.find(entry=>entry.generationId===generationId);
    // Independent keys keep concurrent additions from different tabs from replacing each other.
    target.setItem(HISTORY_PREFIX+generationId,JSON.stringify({generationId,savedAt:previous?.savedAt??now,expiresAt:expires}));
    return readGenerationHistory(now,target).available;
  } catch {return false;}
}

const historyGenerationSchema=z.object({
  generationId:z.string().regex(ID),
  status:z.enum(["queued","generating","processing","completed","failed"]),
  expiresAt:z.iso.datetime(),
  progress:z.object({completedSteps:z.number().int().min(0).max(12),totalSteps:z.number().int().min(1).max(12)}).refine(value=>value.completedSteps<=value.totalSteps),
  pet:z.object({displayName:z.string().min(1).max(80)}).optional(),
  error:z.object({code:z.string().regex(/^[a-z_]{1,64}$/)}).optional(),
});
export type HistoryGeneration = z.infer<typeof historyGenerationSchema>;
export function parseHistoryGeneration(value:unknown,generationId:string):HistoryGeneration|null {
  const result=historyGenerationSchema.safeParse(value);
  return result.success&&result.data.generationId===generationId?result.data:null;
}
