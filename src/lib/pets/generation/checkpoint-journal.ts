import {createHash} from "node:crypto";
import {resultInputHash,resultPromptHash} from "@/lib/pets/generation/result-input";
import {currentWorkerContext,setWorkerPhase} from "@/lib/pets/generation/worker-diagnostics";
import {ANIMATION_ATTEMPT_FAILURE_CODES, GenerationError, type GenerationJob, type StageName, type ImageUsage} from "@/lib/pets/generation/model";
import {latestAnimationAttempt,isAnimationState} from "@/lib/pets/generation/animation-repair";
import {latestBaseAttempt} from "@/lib/pets/generation/base-repair";
import {stageOperation} from "@/lib/pets/generation/execution-slots";
import {activeLease,readActiveWorkerJob,WorkerYield,scheduler,isTaskScheduler,isParallelScheduler} from "@/lib/pets/generation/scheduler";
import {FileResultJournal,JournalError,journalKey,type JournalIdentity,type JournalOutcome} from "@/lib/pets/generation/result-journal";
import {retryCheckpoint,type CheckpointRetryOptions} from "@/lib/pets/generation/checkpoint-retry";
import type {GenerationStore} from "@/lib/pets/generation/store";
import type {CardMetadataResult} from "@/lib/pets/generation/card-provider";
import {isOutputModerationFailure} from "@/lib/pets/generation/provider-failure";
export type ResultDurability={journal:FileResultJournal;now?:()=>number;retry?:CheckpointRetryOptions};
export function imageOperation(job:GenerationJob,stage:StageName){
 const attempt=stage==="base"?latestBaseAttempt(job):isAnimationState(stage)?latestAnimationAttempt(job,stage):undefined;
 return attempt?`${stage==="base"?"base-attempt":"attempt"}:${attempt.token}`:stageOperation(job,stage);
}
export function journalIdentity(job:GenerationJob,operationKey:string,receiptKey:string,stage?:StageName):JournalIdentity{
 const attempt=stage==="base"?latestBaseAttempt(job):stage&&isAnimationState(stage)?latestAnimationAttempt(job,stage):undefined;
 return {jobId:job.id,inputHash:resultInputHash(job,stage),promptHash:resultPromptHash(job),createdAt:job.createdAt,expiresAt:job.expiresAt,operationKey,receiptKey,
  owner:job.worker,leaseId:job.workerLeaseId??`legacy:${job.worker}`,taskKey:job.workerTask?.key??`${job.id}:${stage??"metadata"}`,
  kind:stage?"image":"metadata",...(stage?{stage}:{}),pipelineVersion:job.pipelineVersion,
  ...(attempt?{attemptToken:attempt.token}:{}),...(attempt && "sourceSha256" in attempt && attempt.sourceSha256 ? {previousStageHash:attempt.sourceSha256}:{}),
  ...(!stage&&job.cardMetadata?{requestHash:job.cardMetadata.requestHash,metadataRevision:job.cardMetadata.revision}:{})};
}
interface Service {
 authorizeStage(job:GenerationJob,stage:StageName):Promise<void>;
 authorizeRowRetry(job:GenerationJob,stage:StageName,token:string):Promise<void>;
 startAnimationAttempt(job:GenerationJob,stage:Parameters<typeof latestAnimationAttempt>[1],token:string):Promise<unknown>;
 startBaseAttempt(job:GenerationJob,token:string):Promise<unknown>;
 authorizeCardMetadata(job:GenerationJob):Promise<void>;
 saveStage(job:GenerationJob,stage:StageName,bytes:Buffer,meta:{usage?:ImageUsage;generationMs:number}):Promise<unknown>;
 saveAnimationAttempt(job:GenerationJob,stage:Parameters<typeof latestAnimationAttempt>[1],token:string,bytes:Buffer,meta:{usage?:ImageUsage;generationMs:number}):Promise<unknown>;
 saveBaseAttempt(job:GenerationJob,token:string,bytes:Buffer,meta:{usage?:ImageUsage;generationMs:number}):Promise<unknown>;
 failAnimationAttempt(job:GenerationJob,stage:Parameters<typeof latestAnimationAttempt>[1],token:string,error:GenerationError):Promise<unknown>;
 failBaseAttempt(job:GenerationJob,token:string,error:GenerationError):Promise<unknown>;
 recordRowAttemptFailure(job:GenerationJob,stage:StageName,attempt:1|2,error:GenerationError):Promise<unknown>;
 saveCardMetadata(job:GenerationJob,result:CardMetadataResult):Promise<unknown>;
 failCardMetadata(job:GenerationJob,code:string):Promise<unknown>;
}
export function attachResultJournal<T extends Service>(service:T,store:GenerationStore,durability:ResultDurability):T{
 const original={...service},now=durability.now??Date.now;
 const metadataPreflightRejected=new WeakSet<GenerationJob>();
 const authorizedOperations=new WeakMap<GenerationJob,Map<StageName,string>>();
 const remember=(job:GenerationJob,stage:StageName,operation:string)=>{const entries=authorizedOperations.get(job)??new Map<StageName,string>();entries.set(stage,operation);authorizedOperations.set(job,entries);};
 const operationFor=(job:GenerationJob,stage:StageName)=>authorizedOperations.get(job)?.get(stage)??imageOperation(job,stage);
 async function reserve(job:GenerationJob,operation:string,receipt:string,stage?:StageName){
  const current=await readActiveWorkerJob(store,job,now());
  const identity=journalIdentity(current,operation,receipt,stage),key=journalKey(identity);
  try{return {key:await durability.journal.reserve(identity),identity};}
  catch(error){
   if(error instanceof JournalError&&error.code==="journal_capacity")throw new WorkerYield(now()+5000);
   if(error instanceof JournalError&&error.code==="journal_identity_conflict"){
    const old=await durability.journal.reservationIdentity(key);
    if(await durability.journal.read(key,now()))throw new GenerationError("outcome_unknown");
    const unsent=await store.transaction(async tx=>{const state=await scheduler(tx,now());return isTaskScheduler(state)&&
     !state.providerSlots.some(s=>s.leaseId===old.leaseId)&&state.providerSlots.some(s=>s.jobId===job.id&&s.leaseId===job.workerLeaseId&&s.dispatched===false);});
    if(!unsent)throw error;
    await durability.journal.releaseUnsent(key,old);return {key:await durability.journal.reserve(identity),identity};
   }
   throw error;
  }
 }
 async function authorizeImage<R>(job:GenerationJob,operation:string,receipt:string,stage:StageName,run:()=>Promise<R>){
  const reservation=await reserve(job,operation,receipt,stage);
  try{return await run();}catch(error){
   if(error instanceof WorkerYield||error instanceof GenerationError&&["budget_exhausted","generation_disabled","generation_paused"].includes(error.code)){
    try{
     const unsent=await store.transaction(async tx=>{
      const state=await scheduler(tx,now()),lease=activeLease(state,job.id,job.workerLeaseId);
      return lease?.owner===job.worker&&(!isParallelScheduler(state)||!state.providerSlots.some(slot=>slot.jobId===job.id&&slot.leaseId===job.workerLeaseId&&slot.dispatched!==false));
     });
     if(unsent)await durability.journal.releaseUnsent(reservation.key,reservation.identity);
    }catch(cleanup){const context=currentWorkerContext();if(!context?.primaryReported)context?.report(error);context?.report(cleanup,true);}
   }
   throw error;
  }
 }
 async function save<R>(job:GenerationJob,operation:string,receipt:string,outcome:JournalOutcome,run:()=>Promise<R>){
  const key=journalKey({jobId:job.id,operationKey:operation});
  const context=currentWorkerContext();setWorkerPhase(context,"checkpoint",job);
  let fingerprint:string;
  try{fingerprint=await durability.journal.publish(key,outcome,receipt);}catch(error){
   if(error&&typeof error==="object"&&"code"in error&&error.code==="ENOENT"){
    const expected=outcome.kind==="metadata"?outcome.result.responseHash:createHash("sha256").update(outcome.kind==="image"?outcome.bytes:outcome.code).digest("hex");
    const raw=await store.transaction(tx=>tx.getLedger(`generation-results:${job.id}`,now()));
    if(raw&&JSON.parse(raw).results?.[receipt]===expected)return run();
   }
   context?.report(error);throw error;
  }
  try{return await retryCheckpoint(run,{attempts:5,...durability.retry,now,onError:(_error,pass)=>{if(context)context.checkpointPass=pass;},shouldRetry:error=>!(error instanceof GenerationError)&&job.expiresAt>now()});}
  finally{
   // A failed acknowledgement can still have committed. Removal requires its exact receipt.
   try{
    const raw=await store.transaction(tx=>tx.getLedger(`generation-results:${job.id}`,now()));
    if(raw&&JSON.parse(raw).results?.[receipt]===fingerprint)await durability.journal.confirm(key,fingerprint);
   }catch{ /* Retain the journal for explicit inspection; never replay a provider call. */ }
  }
 }
 const failure=(error:GenerationError):JournalOutcome=>({kind:"failure",code:error.code==="metadata_unavailable"?"metadata_unavailable":ANIMATION_ATTEMPT_FAILURE_CODES.find(code=>code===error.code)??"outcome_unknown",...(error.providerFailure?{providerFailure:error.providerFailure}:{}),
  ...(error.diagnostic?{diagnostic:error.diagnostic}:{}),...(error.cliCause?{cliCause:error.cliCause}:{}),...(error.details?{details:error.details}:{}),...(error.retryAt?{retryAt:error.retryAt}:{}),
  ...(error.code==="outcome_unknown"||isOutputModerationFailure(error.providerFailure)?{}:{costUsd:0})});
 return Object.assign(service,{
  async authorizeStage(job:GenerationJob,stage:StageName){const operation=imageOperation(job,stage);remember(job,stage,operation);return authorizeImage(job,operation,`stage:${stage}`,stage,()=>original.authorizeStage(job,stage));},
  async authorizeRowRetry(job:GenerationJob,stage:StageName,token:string){remember(job,stage,`retry:${token}`);return authorizeImage(job,`retry:${token}`,`stage:${stage}`,stage,()=>original.authorizeRowRetry(job,stage,token));},
  async startAnimationAttempt(job:GenerationJob,stage:Parameters<typeof latestAnimationAttempt>[1],token:string){return authorizeImage(job,`attempt:${token}`,`attempt:${token}`,stage,()=>original.startAnimationAttempt(job,stage,token));},
  async startBaseAttempt(job:GenerationJob,token:string){return authorizeImage(job,`base-attempt:${token}`,`base-attempt:${token}`,"base",()=>original.startBaseAttempt(job,token));},
  async authorizeCardMetadata(job:GenerationJob){
   const operation=`card:${job.cardMetadata?.requestHash}`;metadataPreflightRejected.delete(job);await reserve(job,operation,operation);
   try{return await original.authorizeCardMetadata(job);}catch(error){
    if(error instanceof GenerationError&&["budget_exhausted","generation_disabled"].includes(error.code))metadataPreflightRejected.add(job);
    throw error;
   }
  },
  async saveStage(job:GenerationJob,stage:StageName,bytes:Buffer,meta:{usage?:ImageUsage;generationMs:number}){
   return save(job,operationFor(job,stage),`stage:${stage}`,{kind:"image",bytes,...meta},()=>original.saveStage(job,stage,bytes,meta));},
  async saveAnimationAttempt(job:GenerationJob,stage:Parameters<typeof latestAnimationAttempt>[1],token:string,bytes:Buffer,meta:{usage?:ImageUsage;generationMs:number}){return save(job,`attempt:${token}`,`attempt:${token}`,{kind:"image",bytes,...meta},()=>original.saveAnimationAttempt(job,stage,token,bytes,meta));},
  async saveBaseAttempt(job:GenerationJob,token:string,bytes:Buffer,meta:{usage?:ImageUsage;generationMs:number}){return save(job,`base-attempt:${token}`,`base-attempt:${token}`,{kind:"image",bytes,...meta},()=>original.saveBaseAttempt(job,token,bytes,meta));},
  async failAnimationAttempt(job:GenerationJob,stage:Parameters<typeof latestAnimationAttempt>[1],token:string,error:GenerationError){return save(job,`attempt:${token}`,`failed-attempt:${token}`,failure(error),()=>original.failAnimationAttempt(job,stage,token,error));},
  async failBaseAttempt(job:GenerationJob,token:string,error:GenerationError){return save(job,`base-attempt:${token}`,`base-failure:${token}`,failure(error),()=>original.failBaseAttempt(job,token,error));},
  async recordRowAttemptFailure(job:GenerationJob,stage:StageName,attempt:1|2,error:GenerationError){return save(job,operationFor(job,stage),`failure:${stage}:${attempt}`,failure(error),()=>original.recordRowAttemptFailure(job,stage,attempt,error));},
  async failCardMetadata(job:GenerationJob,code:string){
   const operation=`card:${job.cardMetadata?.requestHash}`,key=journalKey({jobId:job.id,operationKey:operation});
   let identity:JournalIdentity;
   try{identity=await durability.journal.reservationIdentity(key);}catch(error){if(error&&typeof error==="object"&&"code" in error&&error.code==="ENOENT")return original.failCardMetadata(job,code);throw error;}
   const retained=await durability.journal.read(key,now());
   if(retained?.outcomeKind==="metadata")return original.failCardMetadata(job,code);
   const unsent=await store.transaction(async tx=>{const state=await scheduler(tx,now());return isTaskScheduler(state)&&state.providerSlots.some(s=>s.jobId===job.id&&s.leaseId===job.workerLeaseId&&s.dispatched===false);});
   if(unsent||metadataPreflightRejected.has(job)){const result=await original.failCardMetadata(job,code);await durability.journal.releaseUnsent(key,identity);return result;}
   const error=new GenerationError(code);
   return save(job,operation,`card-failure:${job.cardMetadata?.requestHash}`,failure(error),()=>original.failCardMetadata(job,code));
  },
  async saveCardMetadata(job:GenerationJob,result:CardMetadataResult){const operation=`card:${job.cardMetadata?.requestHash}`;return save(job,operation,operation,{kind:"metadata",result},()=>original.saveCardMetadata(job,result));},
 });
}
