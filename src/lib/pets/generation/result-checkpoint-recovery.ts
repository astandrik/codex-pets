import {resultInputHash} from "@/lib/pets/generation/result-input";
import {createHash} from "node:crypto";
import {jobSchema,DAY,GenerationError,type GenerationJob} from "@/lib/pets/generation/model";
import {journalIdentitySchema,type JournalRecord} from "@/lib/pets/generation/result-journal";
import {imageOperation} from "@/lib/pets/generation/checkpoint-journal";
import {latestAnimationAttempt,isAnimationState} from "@/lib/pets/generation/animation-repair";
import {latestBaseAttempt} from "@/lib/pets/generation/base-repair";
import {isRetryableImageCause,isUnsentTlsHandshake} from "@/lib/pets/generation/cli-cause";
import {normalizeCardMetadata} from "@/lib/pets/generation/card-metadata";
import {recordRecoveredResultCost} from "@/lib/pets/generation/expired-generation";
import {scheduler,isTaskScheduler,saveScheduler} from "@/lib/pets/generation/scheduler";
import type {GenerationStore} from "@/lib/pets/generation/store";
const hash=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
export const checkpointJobHash=(job:GenerationJob|null|undefined)=>job?hash(JSON.stringify(job)):null;
export type RecoveryOptions={expectedRevision:number;expectedJobHash:string|null;now?:()=>number;apply?:boolean};
function conflict():never{throw new GenerationError("stage_conflict");}
export async function recoverResult(store:GenerationStore,record:JournalRecord,options:RecoveryOptions){
 const identity=journalIdentitySchema.parse(record.identity),clock=options.now??Date.now;
 return store.transaction(async tx=>{
  let now=clock();if(now>=identity.createdAt+7*DAY)throw new GenerationError("generation_expired");
  const state=await scheduler(tx,now),current=await tx.getJob(identity.jobId);
  if(identity.kind==="image"){
   const success=identity.operationKey.startsWith("attempt:")||identity.operationKey.startsWith("base-attempt:")?identity.operationKey:`stage:${identity.stage}`;
   const failure=identity.operationKey.startsWith("attempt:")?`failed-${identity.operationKey}`:identity.operationKey.startsWith("base-attempt:")?`base-failure:${identity.operationKey.slice(13)}`:`failure:${identity.stage}:${identity.operationKey.startsWith("retry:")?2:1}`;
   if(record.receiptKey!==(record.outcomeKind==="failure"?failure:success))conflict();
  }else if(identity.operationKey!==`card:${identity.requestHash}`||record.receiptKey!==(record.outcomeKind==="failure"?`card-failure:${identity.requestHash}`:identity.operationKey))conflict();
  const receiptRaw=await tx.getLedger(`generation-results:${identity.jobId}`,now);
  const receipt=receiptRaw?JSON.parse(receiptRaw):{results:{}};
  if(receipt.results?.[record.receiptKey]===record.fingerprint)return {mode:"noop" as const,applied:false};
  if(receipt.results?.[record.receiptKey]!==undefined)conflict();
  if(state.revision!==options.expectedRevision||checkpointJobHash(current)!==options.expectedJobHash||!isTaskScheduler(state))conflict();
  if(state.tasks.some(t=>t.jobId===identity.jobId&&t.status==="running")||state.heavy?.jobId===identity.jobId)throw new GenerationError("stale_worker");
  const slot=state.providerSlots.find(s=>s.jobId===identity.jobId&&s.key===identity.operationKey&&s.leaseId===identity.leaseId&&s.owner===identity.owner&&s.unknown);
  if(!slot||slot.dispatched===false)conflict();
  const expired=now>=identity.expiresAt;
  if(!current&&!expired)conflict();
  if(current&&(current.createdAt!==identity.createdAt||current.expiresAt!==identity.expiresAt||current.pipelineVersion!==identity.pipelineVersion))conflict();
  const outcome=record.outcome;
  const retainedFailure=outcome?.kind==="failure"?outcome:record.failure;
  if(retainedFailure?.code==="provider_not_sent"&&(!isUnsentTlsHandshake(retainedFailure.cliCause)||retainedFailure.providerFailure!==undefined||record.costUsd!==0))conflict();
  if(!outcome&&!expired)conflict();
  let updated:GenerationJob|null=null;
  let mode:"image"|"failure"|"metadata"|"accounting-only"="accounting-only";
  if(identity.kind==="image"){
   const name=identity.stage!;
   const expectedSuccess=identity.operationKey.startsWith("attempt:")||identity.operationKey.startsWith("base-attempt:")?identity.operationKey:`stage:${name}`;
   const expectedFailure=identity.operationKey.startsWith("attempt:")?`failed-${identity.operationKey}`:identity.operationKey.startsWith("base-attempt:")?`base-failure:${identity.operationKey.slice(13)}`:`failure:${name}:${identity.operationKey.startsWith("retry:")?2:1}`;
   if(record.receiptKey!==(record.outcomeKind==="failure"?expectedFailure:expectedSuccess))conflict();
   if(current&&!expired){
    if(current.status!=="failed"||imageOperation(current,name)!==identity.operationKey)conflict();
    // Terminal failure deliberately clears the prompt; its retained hash is still bound to all other immutable inputs.
    if(resultInputHash(current,name,current.prompt===""?identity.promptHash:undefined)!==identity.inputHash)conflict();
    const stage=current.stages.find(s=>s.name===name);if(!stage)conflict();
    if(identity.previousStageHash?stage.sha256!==identity.previousStageHash:stage.status!=="inflight")conflict();
    const attempt=name==="base"?latestBaseAttempt(current):isAnimationState(name)?latestAnimationAttempt(current,name):undefined;
    if(identity.attemptToken!==attempt?.token)conflict();
    if(outcome?.kind==="image"){
     if(hash(outcome.bytes)!==record.fingerprint||outcome.bytes.length>8*1024*1024||!outcome.bytes.length)conflict();
     const result={usage:outcome.usage,generationMs:outcome.generationMs,resultSha256:record.fingerprint,finishedAt:now,status:"saved" as const};
     updated={...current,stages:current.stages.map(s=>s.name===name?{...s,status:"completed",sha256:record.fingerprint,usage:outcome.usage,generationMs:outcome.generationMs}:s),
      ...(current.animationRepair&&isAnimationState(name)?{animationRepair:{...current.animationRepair,pending:current.animationRepair.pending.filter(s=>s!==name),attempts:current.animationRepair.attempts.map(a=>a.token===identity.attemptToken?{...a,...result}:a)}}:{}),
      ...(current.baseRepair&&name==="base"?{baseRepair:{...current.baseRepair,phase:"complete",attempts:current.baseRepair.attempts.map(a=>a.token===identity.attemptToken?{...a,...result}:a)}}:{}),
      ...(current.rowRetries?{rowRetries:current.rowRetries.map(r=>r.stage===name?{...r,state:"completed"}:r)}:{})};
     if(name==="base"&&current.reviewBase&&current.baseConfirmedAt===undefined&&current.stages.length===1){
      updated={...updated,status:"awaiting_confirmation",worker:"",leaseUntil:undefined,error:undefined,
       providerFailure:undefined,failureDiagnostic:undefined,stageFailureDiagnostics:undefined,cliFailureCauses:undefined,
       ...(current.animationRepair&&!current.animationRepair.attempts.length?{animationRepair:{...current.animationRepair,phase:"initial",pending:[],issues:[]}}:{})};
     }
     mode="image";
    }else if(outcome?.kind==="failure"){
     if(hash(outcome.code)!==record.fingerprint)conflict();
     const failure={code:outcome.code==="metadata_unavailable"?"outcome_unknown" as const:outcome.code,
      ...(outcome.diagnostic?{diagnostic:outcome.diagnostic}:{}),...(outcome.cliCause?{cliCause:outcome.cliCause}:{}),...(outcome.providerFailure?{providerFailure:outcome.providerFailure}:{})};
     const status=outcome.code==="outcome_unknown"&&!isRetryableImageCause(outcome.cliCause)?"unknown" as const:"failed" as const;
     updated={...current,
      ...(current.animationRepair&&isAnimationState(name)?{animationRepair:{...current.animationRepair,attempts:current.animationRepair.attempts.map(a=>a.token===identity.attemptToken?{...a,status,finishedAt:now,failure}:a)}}:{}),
      ...(current.baseRepair&&name==="base"?{baseRepair:{...current.baseRepair,attempts:current.baseRepair.attempts.map(a=>a.token===identity.attemptToken?{...a,status,finishedAt:now,failure}:a)}}:{})};mode="failure";
    }else conflict();
   }
  }else{
   if(identity.operationKey!==`card:${identity.requestHash}`||record.receiptKey!==(record.outcomeKind==="failure"?`card-failure:${identity.requestHash}`:identity.operationKey))conflict();
   if(current&&current.cardMetadata?.requestHash!==identity.requestHash)conflict();
   if(current&&current.cardMetadata&&!expired&&current.status==="processing"&&!current.cardMetadata.edited&&current.cardMetadata.revision===identity.metadataRevision&&outcome?.kind==="metadata"){
    if(outcome.result.responseHash!==record.fingerprint)conflict();const fields=normalizeCardMetadata(outcome.result.fields);
    const displayName=current.nameSource==="automatic"?(fields.displayName??current.displayName):current.displayName;
    updated={...current,displayName,cardMetadata:{...current.cardMetadata,state:"completed",fields:{...fields,displayName},responseHash:record.fingerprint,usage:{inputTokens:outcome.result.inputTokens,outputTokens:outcome.result.outputTokens,costUsd:outcome.result.costUsd}}};mode="metadata";
   }
  }
  if(updated)updated=jobSchema.parse(updated);
  now=clock();if(now>=identity.createdAt+7*DAY||(!expired&&now>=identity.expiresAt))throw new GenerationError("generation_expired");
  if(options.apply){
   await recordRecoveredResultCost(tx,identity,now,{key:record.receiptKey,fingerprint:record.fingerprint},record.costUsd===undefined?undefined:{costUsd:record.costUsd},identity.stage??"card");
   if(updated&&outcome?.kind==="image")await tx.putArtifact(identity.jobId,`stage-${identity.stage}.png`,outcome.bytes,identity.expiresAt);
   if(updated)await tx.putJob(updated);
   const failure=outcome?.kind==="failure"?outcome:record.failure;
   const unresolved=record.outcomeKind==="failure"&&(!failure||failure.code==="outcome_unknown"&&!isRetryableImageCause(failure.cliCause));
   if(!unresolved)state.providerSlots=state.providerSlots.filter(s=>s!==slot);
   // Preserve the global pause and unrelated operations, even after a successful restore.
   await saveScheduler(tx,state);
   if(clock()>=identity.createdAt+7*DAY||(!expired&&clock()>=identity.expiresAt))throw new GenerationError("generation_expired");
  }
  return {mode,applied:Boolean(options.apply),schedulerRevision:options.expectedRevision,jobHash:options.expectedJobHash};
 });
}
