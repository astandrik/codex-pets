import {constants} from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import {createHash, randomBytes} from "node:crypto";
import {z} from "zod";
import {STAGE_NAMES, usageSchema, ANIMATION_ATTEMPT_FAILURE_CODES} from "@/lib/pets/generation/model";
import {cardMetadataFieldsSchema} from "@/lib/pets/generation/card-metadata";
import {failureDiagnosticSchema} from "@/lib/pets/generation/failure-diagnostic";
import {providerFailureSchema} from "@/lib/pets/generation/provider-failure";
import {cliCauseSchema, errorDetailsSchema} from "@/lib/pets/generation/cli-cause";

const sha = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
function canonical(value:unknown):unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==="object")return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,item])=>[key,canonical(item)]));
  return value;
}
const integrity=(value:unknown)=>sha(JSON.stringify(canonical(value)));
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const MAX_PAYLOAD = 8 * 1024 * 1024, MAX_JSON = 64 * 1024, WEEK = 7 * 86400000;
export const journalIdentitySchema = z.object({
  jobId:digest, inputHash:digest,promptHash:digest,createdAt:z.number().finite().nonnegative(), expiresAt:z.number().finite(),
  operationKey:z.string().min(1).max(200), receiptKey:z.string().min(1).max(128),
  leaseId:z.string().min(1).max(128), owner:z.string().min(1).max(200), taskKey:z.string().min(1).max(200),
  kind:z.enum(["image","metadata"]), stage:z.enum(STAGE_NAMES).optional(), pipelineVersion:z.number().int().min(1),
  attemptToken:z.string().max(128).optional(), previousStageHash:digest.optional(),
  requestHash:digest.optional(), metadataRevision:z.number().int().nonnegative().optional(),
}).strict().refine(v=>v.expiresAt>v.createdAt && (v.kind!=="image" || v.stage!==undefined));
export type JournalIdentity = z.infer<typeof journalIdentitySchema>;
const metadataResultSchema=z.object({fields:cardMetadataFieldsSchema,responseHash:digest,inputTokens:z.number().int().nonnegative(),outputTokens:z.number().int().nonnegative(),costUsd:z.number().finite().nonnegative()}).strict();
const failureSchema=z.object({kind:z.literal("failure"),code:z.enum([...ANIMATION_ATTEMPT_FAILURE_CODES,"metadata_unavailable"]),
  providerFailure:providerFailureSchema.optional(),diagnostic:failureDiagnosticSchema.optional(),cliCause:cliCauseSchema.optional(),
  details:errorDetailsSchema.optional(),retryAt:z.iso.datetime().optional(),costUsd:z.number().finite().nonnegative().optional()}).strict();
const jsonOutcomeSchema=z.union([failureSchema,z.object({kind:z.literal("metadata"),result:metadataResultSchema}).strict()]);
export type JournalOutcome = {kind:"image";bytes:Buffer;generationMs:number;usage?:z.infer<typeof usageSchema>} | z.infer<typeof jsonOutcomeSchema>;
const retainedFailureSchema=z.object({code:failureSchema.shape.code,cliCause:cliCauseSchema.optional(),providerFailure:providerFailureSchema.optional()}).strict();
const manifestSchema=z.object({checksum:digest,version:z.literal(1),receiptKey:z.string().max(128),fingerprint:digest,payloadSha256:digest,size:z.number().int().min(1).max(MAX_PAYLOAD),kind:z.enum(["image","metadata","failure"]),
  failure:retainedFailureSchema.optional(),generationMs:z.number().finite().nonnegative().optional(),usage:usageSchema.optional(),costUsd:z.number().finite().nonnegative().optional()}).strict().refine(v=>v.kind!=="image"||v.generationMs!==undefined);
const intentSchema=z.object({checksum:digest,version:z.literal(1),identity:journalIdentitySchema,slot:z.number().int().nonnegative(),reservationId:z.string().regex(/^[a-f0-9]{32}$/).optional()}).strict();
export type JournalRecord = {key:string;identity:JournalIdentity;fingerprint:string;receiptKey:string;outcomeKind:"image"|"metadata"|"failure";failure?:z.infer<typeof retainedFailureSchema>;outcome:JournalOutcome|null;costUsd?:number};
export class JournalError extends Error {constructor(readonly code:string){super(code);this.name="JournalError";}}
export function journalKey(identity:Pick<JournalIdentity,"jobId"|"operationKey">){return sha(identity.jobId+"\0"+identity.operationKey);}
const missing=(e:unknown)=>Boolean(e&&typeof e==="object"&&"code"in e&&e.code==="ENOENT");
const exists=(e:unknown)=>Boolean(e&&typeof e==="object"&&"code"in e&&["EEXIST","ENOTEMPTY"].includes(String(e.code)));
async function privateDirectory(folder:string){
  await fs.mkdir(folder,{recursive:true,mode:0o700});const stat=await fs.lstat(folder);
  if(!stat.isDirectory()||stat.isSymbolicLink()||(stat.mode&0o077)!==0)throw new JournalError("journal_permissions");
}
async function syncDirectory(folder:string){const handle=await fs.open(folder,"r");try{await handle.sync();}finally{await handle.close();}}
async function durableWrite(file:string,bytes:Buffer|string){
  const h=await fs.open(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
}
async function readPrivate(file:string,max:number){
  const h=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const st=await h.stat();if(!st.isFile()||st.size>max||(st.mode&0o077)!==0)throw new JournalError("journal_corrupt");return await h.readFile();}finally{await h.close();}
}
export class FileResultJournal {
  static readonly reservationBytes=MAX_PAYLOAD+MAX_JSON*2;
  private constructor(readonly root:string,private readonly slots:number){}
  static async open(root:string,options:{capacityBytes?:number}={}){
    root=path.resolve(root);await privateDirectory(root);await privateDirectory(path.join(root,"records"));await privateDirectory(path.join(root,"slots"));
    const capacity=options.capacityBytes??512*1024*1024;
    if(!Number.isSafeInteger(capacity)||capacity<FileResultJournal.reservationBytes)throw new JournalError("journal_capacity");
    const config=JSON.stringify({version:1,capacity});
    const configTemp=path.join(root,"config-"+randomBytes(8).toString("hex"));
    try{await durableWrite(configTemp,config);try{await fs.link(configTemp,path.join(root,"config.json"));await syncDirectory(root);}catch(error){if(!exists(error))throw error;}}
    finally{await fs.rm(configTemp,{force:true});}
    if((await readPrivate(path.join(root,"config.json"),MAX_JSON)).toString()!==config)throw new JournalError("journal_config_mismatch");
    const journal=new FileResultJournal(root,Math.floor(capacity/FileResultJournal.reservationBytes));
    await journal.finishRetirements();return journal;
  }
  static async openExisting(root:string){
    root=path.resolve(root);const st=await fs.lstat(root);
    if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0)throw new JournalError("journal_permissions");
    const config=z.object({version:z.literal(1),capacity:z.number().int().min(FileResultJournal.reservationBytes)}).strict().parse(JSON.parse((await readPrivate(path.join(root,"config.json"),MAX_JSON)).toString()));
    return new FileResultJournal(root,Math.floor(config.capacity/FileResultJournal.reservationBytes));
  }
  private directory(key:string){if(!digest.safeParse(key).success)throw new JournalError("journal_invalid_key");return path.join(this.root,"records",key);}
  private async intentAt(folder:string,key:string){
    const st=await fs.lstat(folder);
    if(!st.isDirectory()||st.isSymbolicLink())throw new JournalError("journal_corrupt");
    return this.decodeIntent(await readPrivate(path.join(folder,"intent.json"),MAX_JSON),key);
  }
  private decodeIntent(bytes:Buffer,key?:string){
    const value=intentSchema.parse(JSON.parse(bytes.toString()));
    const {checksum,...content}=value;
    if(checksum!==integrity(content)||(key!==undefined&&journalKey(value.identity)!==key)||value.slot>=this.slots)throw new JournalError("journal_corrupt");return value;
  }
  private intent(key:string){return this.intentAt(this.directory(key),key);}
  private async removeEmptyDirectory(folder:string){
    try{await fs.rmdir(folder);}catch(error){if(!missing(error)&&!exists(error))throw error;}
  }
  private async releaseSlot(key:string,intent:Pick<z.infer<typeof intentSchema>,"slot"|"reservationId">){
    const slot=path.join(this.root,"slots",String(intent.slot));
    if(intent.reservationId){
      const owned=path.join(slot,intent.reservationId);
      try{
        const stat=await fs.lstat(owned);if(!stat.isDirectory()||stat.isSymbolicLink())throw new JournalError("journal_corrupt");
        try{if((await readPrivate(path.join(owned,"key"),128)).toString()!==key)throw new JournalError("journal_corrupt");}
        catch(error){if(!missing(error))throw error;}
        // The unique nonce remains ownership proof if an interrupted rm already removed key.
        await fs.rm(owned,{recursive:true,force:true});
      }catch(error){if(!missing(error))throw error;}
    }else{
      try{if((await readPrivate(path.join(slot,"key"),128)).toString()!==key)throw new JournalError("journal_corrupt");await fs.rm(path.join(slot,"key"),{force:true});}
      catch(error){if(!missing(error))throw error;}
    }
    await this.removeEmptyDirectory(slot);await syncDirectory(path.join(this.root,"slots"));
  }
  private async expireOrphanedReservation(slot:number,reservationId:string|undefined,now:number){
    const reservation=path.join(this.root,"slots",String(slot)),owned=reservationId?path.join(reservation,reservationId):reservation;
    let key:string,deadline:number;
    try{
      const st=await fs.lstat(owned);if(!st.isDirectory()||st.isSymbolicLink())throw new JournalError("journal_corrupt");
      let saved:z.infer<typeof intentSchema>|undefined;
      try{saved=this.decodeIntent(await readPrivate(path.join(owned,"intent.json"),MAX_JSON));}catch(error){if(!missing(error))throw error;}
      if(saved){
        if(saved.slot!==slot||saved.reservationId!==reservationId)throw new JournalError("journal_corrupt");
        key=journalKey(saved.identity);deadline=saved.identity.createdAt+WEEK;
        try{if((await readPrivate(path.join(owned,"key"),128)).toString()!==key)throw new JournalError("journal_corrupt");}catch(error){if(!missing(error))throw error;}
      }else{
        try{key=(await readPrivate(path.join(owned,"key"),128)).toString();}
        catch(error){if(!missing(error))throw error;await this.removeEmptyDirectory(owned);await this.removeEmptyDirectory(reservation);return;}
        if(!digest.safeParse(key).success)throw new JournalError("journal_corrupt");
        // Old slots did not retain identity; allow a full receipt lifetime after their last change.
        deadline=st.mtimeMs+WEEK;
      }
      if(now<deadline)return;
      try{
        const current=await this.intent(key);
        if(current.slot===slot&&current.reservationId===reservationId)return;
      }catch(error){if(!missing(error))throw error;}
      await this.releaseSlot(key,{slot,reservationId});
      // Never recursively remove a record that another writer may have populated.
      await this.removeEmptyDirectory(this.directory(key));
    }catch(error){if(!missing(error))throw error;}
  }
  private async expireOrphanedSlots(now:number){
    const root=path.join(this.root,"slots");
    for(const entry of await fs.readdir(root,{withFileTypes:true})){
      if(!/^(0|[1-9]\d*)$/.test(entry.name)||Number(entry.name)>=this.slots)continue;
      if(!entry.isDirectory()||entry.isSymbolicLink())throw new JournalError("journal_corrupt");
      const slot=Number(entry.name),folder=path.join(root,entry.name);
      let children:import("node:fs").Dirent[];
      try{children=await fs.readdir(folder,{withFileTypes:true});}catch(error){if(missing(error))continue;throw error;}
      if(children.some(child=>child.name==="key"))await this.expireOrphanedReservation(slot,undefined,now);
      for(const child of children){
        if(!/^[a-f0-9]{32}$/.test(child.name))continue;
        if(!child.isDirectory()||child.isSymbolicLink())throw new JournalError("journal_corrupt");
        await this.expireOrphanedReservation(slot,child.name,now);
      }
      await this.removeEmptyDirectory(folder);
    }
  }
  private async finishRetirements(){
    const root=path.join(this.root,"retired");let entries:string[];
    try{entries=await fs.readdir(root);}catch(error){if(missing(error))return;throw error;}
    for(const entry of entries){
      if(!/^[a-f0-9]{64}-[a-f0-9]{32}$/.test(entry))continue;
      const key=entry.slice(0,64),folder=path.join(root,entry);
      try{
        const intent=await this.intentAt(folder,key);
        if(intent.reservationId&&entry.slice(65)!==intent.reservationId)throw new JournalError("journal_corrupt");
        await this.releaseSlot(key,intent);await fs.rm(folder,{recursive:true,force:true});
      }catch(error){
        if(!missing(error))throw error;
        // A retired record is already closed; missing intent means its recursive deletion was interrupted.
        await fs.rm(folder,{recursive:true,force:true});
      }
    }
    await syncDirectory(root);
  }
  private async retire(key:string,intent:z.infer<typeof intentSchema>){
    const retired=path.join(this.root,"retired");await privateDirectory(retired);await syncDirectory(this.root);
    const destination=path.join(retired,`${key}-${intent.reservationId??randomBytes(16).toString("hex")}`);
    // Moving the complete record preserves the ownership proof across every cleanup crash.
    try{await fs.rename(this.directory(key),destination);}catch(error){if(!missing(error))throw error;await this.finishRetirements();return;}
    await syncDirectory(path.join(this.root,"records"));await syncDirectory(retired);
    await this.finishRetirements();
  }
  async reserve(input:JournalIdentity){
    await this.finishRetirements();
    const identity=journalIdentitySchema.parse(input),key=journalKey(identity),folder=this.directory(key);
    try{const old=await this.intent(key);if(JSON.stringify(old.identity)!==JSON.stringify(identity))throw new JournalError("journal_identity_conflict");return key;}
    catch(error){if(!missing(error))throw error;}
    const disk=await fs.statfs(this.root);if(disk.bavail*disk.bsize<FileResultJournal.reservationBytes)throw new JournalError("journal_capacity");
    const preparing=path.join(this.root,"preparing");await privateDirectory(preparing);
    const reservationId=randomBytes(16).toString("hex"),prepared=path.join(preparing,reservationId);
    await fs.mkdir(prepared,{mode:0o700});await fs.mkdir(path.join(prepared,reservationId),{mode:0o700});
    try{
      await durableWrite(path.join(prepared,reservationId,"key"),key);
      await syncDirectory(path.join(prepared,reservationId));await syncDirectory(prepared);
      for(let slot=0;slot<this.slots;slot++){
        const reservation=path.join(this.root,"slots",String(slot));
        try{if((await fs.readdir(reservation)).length)continue;}catch(error){if(!missing(error))throw error;}
        const intent={version:1 as const,identity,slot,reservationId},intentFile=path.join(prepared,reservationId,"intent.json");
        // Retain ownership and the original deadline before the slot becomes visible to peers.
        await durableWrite(intentFile,JSON.stringify({checksum:integrity(intent),...intent}));
        await syncDirectory(path.dirname(intentFile));await syncDirectory(prepared);
        // Publish a nonempty reservation atomically: an old rmdir cannot erase a new claim.
        try{await fs.rename(prepared,reservation);}catch(error){if(exists(error)){await fs.rm(intentFile);continue;}throw error;}
        const owned=path.join(reservation,reservationId);let created=false;
        try{
          await syncDirectory(path.join(this.root,"slots"));await syncDirectory(preparing);
          await fs.mkdir(folder,{mode:0o700});created=true;
          await fs.link(path.join(owned,"intent.json"),path.join(folder,"intent.json"));
          await syncDirectory(folder);await syncDirectory(path.dirname(folder));return key;
        }catch(error){
          if(created)await fs.rm(folder,{recursive:true,force:true});
          await fs.rm(owned,{recursive:true,force:true});await this.removeEmptyDirectory(reservation);
          if(exists(error)){const old=await this.intent(key);if(JSON.stringify(old.identity)===JSON.stringify(identity))return key;throw new JournalError("journal_identity_conflict");}
          throw error;
        }
      }
      throw new JournalError("journal_capacity");
    }finally{await fs.rm(prepared,{recursive:true,force:true});}
  }
  async publish(key:string,outcome:JournalOutcome,receiptKey?:string){
    const intent=await this.intent(key),folder=this.directory(key);
    if(outcome.kind!=="failure"&&outcome.kind!==intent.identity.kind)throw new JournalError("journal_identity_conflict");
    let bytes:Buffer,fingerprint:string,extra:Pick<z.infer<typeof manifestSchema>,"generationMs"|"usage"|"costUsd"|"failure">={};
    if(outcome.kind==="image"){
      if(!Buffer.isBuffer(outcome.bytes)||!Number.isFinite(outcome.generationMs)||outcome.generationMs<0)throw new JournalError("journal_invalid_result");
      bytes=outcome.bytes;fingerprint=sha(bytes);extra={generationMs:outcome.generationMs,...(outcome.usage?{usage:usageSchema.parse(outcome.usage),costUsd:outcome.usage.costUsd}:{})};
    }else{
      const safe=jsonOutcomeSchema.parse(outcome);bytes=Buffer.from(JSON.stringify(safe));
      fingerprint=safe.kind==="metadata"?safe.result.responseHash:sha(safe.code);
      extra={...(safe.kind==="failure"?{failure:retainedFailureSchema.parse({code:safe.code,cliCause:safe.cliCause,providerFailure:safe.providerFailure})}:{}),...(safe.kind==="metadata"?{costUsd:safe.result.costUsd}:safe.costUsd===undefined?{}:{costUsd:safe.costUsd})};
    }
    if(!bytes.length||bytes.length>(outcome.kind==="image"?MAX_PAYLOAD:MAX_JSON))throw new JournalError("journal_invalid_result");
    const content={version:1 as const,receiptKey:receiptKey??intent.identity.receiptKey,kind:outcome.kind,size:bytes.length,payloadSha256:sha(bytes),fingerprint,...extra};
    const manifest=manifestSchema.parse({checksum:integrity(content),...content});
    try{const old=await this.manifest(key);if(old.fingerprint!==fingerprint||old.payloadSha256!==manifest.payloadSha256||old.receiptKey!==manifest.receiptKey)throw new JournalError("journal_result_conflict");return fingerprint;}catch(error){if(!missing(error))throw error;}
    const temporary=path.join(folder,"publish-"+randomBytes(8).toString("hex"));await fs.mkdir(temporary,{mode:0o700});
    try{
      await durableWrite(path.join(temporary,"payload"),bytes);await durableWrite(path.join(temporary,"manifest.json"),JSON.stringify(manifest));await syncDirectory(temporary);
      try{await fs.rename(temporary,path.join(folder,"ready"));await syncDirectory(folder);}
      catch(error){if(!exists(error))throw error;const old=await this.manifest(key);if(old.fingerprint!==fingerprint||old.payloadSha256!==manifest.payloadSha256)throw new JournalError("journal_result_conflict");}
    }finally{await fs.rm(temporary,{recursive:true,force:true});}
    return fingerprint;
  }
  private async manifest(key:string){
    const folder=path.join(this.directory(key),"ready");const st=await fs.lstat(folder);if(!st.isDirectory()||st.isSymbolicLink())throw new JournalError("journal_corrupt");
    const value=manifestSchema.parse(JSON.parse((await readPrivate(path.join(folder,"manifest.json"),MAX_JSON)).toString()));
    const {checksum,...content}=value;if(checksum!==integrity(content))throw new JournalError("journal_corrupt");return value;
  }
  async read(key:string,now=Date.now()):Promise<JournalRecord|null>{
    let intent:z.infer<typeof intentSchema>,manifest:z.infer<typeof manifestSchema>;
    try{intent=await this.intent(key);manifest=await this.manifest(key);}catch(error){if(missing(error))return null;throw error;}
    if(now>=intent.identity.createdAt+WEEK)return null;
    if(now>=intent.identity.expiresAt){return {key,identity:intent.identity,fingerprint:manifest.fingerprint,receiptKey:manifest.receiptKey,outcomeKind:manifest.kind,failure:manifest.failure,outcome:null,costUsd:manifest.costUsd};}
    const bytes=await readPrivate(path.join(this.directory(key),"ready","payload"),MAX_PAYLOAD);
    if(bytes.length!==manifest.size||sha(bytes)!==manifest.payloadSha256)throw new JournalError("journal_corrupt");
    const outcome:JournalOutcome=manifest.kind==="image"?{kind:"image",bytes,generationMs:manifest.generationMs!,...(manifest.usage?{usage:manifest.usage}:{})}:jsonOutcomeSchema.parse(JSON.parse(bytes.toString()));
    return {key,identity:intent.identity,fingerprint:manifest.fingerprint,receiptKey:manifest.receiptKey,outcomeKind:manifest.kind,failure:manifest.failure,outcome,costUsd:manifest.costUsd};
  }
  async confirm(key:string,fingerprint:string){
    let intent:z.infer<typeof intentSchema>;
    try{intent=await this.intent(key);}catch(error){if(!missing(error))throw error;await this.finishRetirements();return;}
    const manifest=await this.manifest(key);if(manifest.fingerprint!==fingerprint)throw new JournalError("journal_result_conflict");
    await this.retire(key,intent);
  }
  async reservationIdentity(key:string){return (await this.intent(key)).identity;}
  async releaseUnsent(key:string,expected:JournalIdentity){
    const intent=await this.intent(key);
    if(JSON.stringify(intent.identity)!==JSON.stringify(journalIdentitySchema.parse(expected)))throw new JournalError("journal_identity_conflict");
    try{await this.manifest(key);throw new JournalError("journal_result_exists");}catch(error){if(!missing(error))throw error;}
    await this.retire(key,intent);
  }
  async list(){return (await fs.readdir(path.join(this.root,"records"))).filter(key=>digest.safeParse(key).success);}
  async expire(now=Date.now()){
    await this.finishRetirements();
    for(const key of await this.list()){
      let intent:z.infer<typeof intentSchema>;
      try{intent=await this.intent(key);}catch(error){if(missing(error))continue;throw error;}
      if(now>=intent.identity.createdAt+WEEK){await this.retire(key,intent);continue;}
      if(now<intent.identity.expiresAt)continue;
      const folder=this.directory(key);let entries:import("node:fs").Dirent[];
      try{entries=await fs.readdir(folder,{withFileTypes:true});}catch(error){if(missing(error))continue;throw error;}
      for(const entry of entries){
        if(entry.name!=="ready"&&!/^publish-[a-f0-9]{16}$/.test(entry.name))continue;
        if(entry.isSymbolicLink()||!entry.isDirectory())throw new JournalError("journal_corrupt");
        await fs.rm(path.join(folder,entry.name,"payload"),{force:true});
      }
    }
    await this.expireOrphanedSlots(now);
  }
}
