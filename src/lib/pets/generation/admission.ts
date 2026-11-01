import {initialAnimationRepair} from "@/lib/pets/generation/animation-repair";
import {startBudgetTracking,type GenerationBudgetLimit} from "@/lib/pets/generation/budget";
import {encodeGenerationInput,GENERATION_INPUT_ARTIFACT} from "@/lib/pets/generation/generation-input";
import {DAY,GenerationError,generationAnimationRevisionsEnabled,nextMoscowDay,PROMPT_REVISION,type GenerationInput,type GenerationJob,type GenerationReference} from "@/lib/pets/generation/model";
import {consumeDailyQuota,readDailyQuota} from "@/lib/pets/generation/quota-grants";
import {expireQueue,requireQueueCapacity,saveScheduler,scheduler} from "@/lib/pets/generation/scheduler";
import type {GenerationTransaction} from "@/lib/pets/generation/store";

export type AdmissionOptions = {
  now:()=>number; enabled:()=>boolean; secret:()=>string; budgetUsd:()=>GenerationBudgetLimit;
  automaticAnimationRepair?:()=>boolean; automaticCardMetadata?:()=>boolean; baseRetries:()=>boolean;
};
export type PreparedAdmission = {
  id:string; input:GenerationInput; reviewBase?:boolean; reference?:GenerationReference;
  acceptedAt:number; sourceDeadline?:number; baseRetrySourceId?:string; baseMaxRetries?:number;
};

export async function admitGeneration(tx:GenerationTransaction,prepared:PreparedAdmission,clientIp:string|null,options:AdmissionOptions):Promise<GenerationJob> {
  if(!options.enabled())throw new GenerationError("generation_disabled");
  if(!clientIp)throw new GenerationError("client_ip_unavailable");
  const now=prepared.acceptedAt,secret=options.secret(),{id,input,reference,reviewBase}=prepared;
  const state=await scheduler(tx,now);
  await expireQueue(tx,state,now);
  if(state.pauseReason)throw new GenerationError("generation_paused");
  const quota=await readDailyQuota(tx,secret,clientIp,now);
  if(!quota.globalRemaining)throw new GenerationError("rate_limited",nextMoscowDay(now),undefined,"global");
  if(!quota.ipRemaining)throw new GenerationError("rate_limited",nextMoscowDay(now),undefined,"ip");
  requireQueueCapacity(state);
  await startBudgetTracking(tx,id,now,options.budgetUsd());
  const job:GenerationJob={...(options.automaticAnimationRepair?.()?{animationRepair:initialAnimationRepair()}:{}),
    id,prompt:input.prompt,displayName:input.displayName??"Generated pet",status:"queued",createdAt:now,expiresAt:now+DAY,worker:"",
    promptRevision:reviewBase?"pet-v2-review-20261017-1":PROMPT_REVISION,...(reviewBase?{reviewBase:true,queuedAt:now}:{}),
    ...(reference?{reference:reference.metadata}:{}),pipelineVersion:2,stages:[],
    ...(generationAnimationRevisionsEnabled()?{animationAnatomyPolicy:1 as const}:{}),nameSource:input.displayName===undefined?"automatic":"user",
    ...(options.automaticCardMetadata?.()?{cardMetadata:{policy:1 as const,state:"pending" as const,revision:0,edited:false}}:{}),
    ...(prepared.baseMaxRetries!==undefined?{baseRepair:{policy:1 as const,maxAttempts:prepared.baseMaxRetries+1,phase:"active" as const,attempts:[]}}:{}),
    ...(prepared.baseRetrySourceId?{baseRetrySourceId:prepared.baseRetrySourceId}:{})};
  if(reference)await tx.putArtifact(id,"reference.png",reference.bytes,job.expiresAt);
  if(reviewBase&&options.baseRetries()){
    const saved=encodeGenerationInput(input,reference);
    job.retryInput={policy:1,sha256:saved.sha256};
    await tx.putArtifact(id,GENERATION_INPUT_ARTIFACT,saved.bytes,job.expiresAt);
  }
  await tx.putJob(job);
  await consumeDailyQuota(tx,secret,clientIp,now,quota);
  state.queue.push(id);await saveScheduler(tx,state);
  if(prepared.sourceDeadline!==undefined&&prepared.sourceDeadline<=options.now())throw new GenerationError("generation_expired");
  return job;
}
