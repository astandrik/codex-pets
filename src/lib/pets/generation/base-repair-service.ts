import {isOutputModerationFailure} from "@/lib/pets/generation/provider-failure";
import {createHash,randomUUID} from "node:crypto";
import {z} from "zod";
import {baseRepairSchema,ANIMATION_ATTEMPT_FAILURE_CODES,GenerationError,moscowDay,type BaseAttempt,type GenerationJob,type Scheduler,type ImageUsage} from "@/lib/pets/generation/model";
import {baseFailureRetryReason,latestBaseAttempt} from "@/lib/pets/generation/base-repair";
import {checkStageBudget,recordStageCost,type GenerationBudgetLimit} from "@/lib/pets/generation/budget";
import {requireJobWithActiveWorkerLease,scheduler,saveScheduler} from "@/lib/pets/generation/scheduler";
import type {GenerationStore,GenerationTransaction} from "@/lib/pets/generation/store";

const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
type Options={now:()=>number;enabled:()=>boolean;budgetUsd:()=>GenerationBudgetLimit};
export function createBaseRepairService(store:GenerationStore,options:Options){
  async function withJob<T>(job:GenerationJob,run:(tx:GenerationTransaction,current:GenerationJob,state:Scheduler,now:number)=>Promise<T>){
    return store.transaction(async tx=>{
      const state=await scheduler(tx,options.now()),now=options.now();
      const current=await requireJobWithActiveWorkerLease(tx,state,job,now);
      if(current.status!=="generating"||current.pipelineVersion!==2||!current.baseRetrySourceId||!current.reviewBase||current.baseConfirmedAt!==undefined||current.continuation||current.animationRevision||!current.baseRepair)throw new GenerationError("invalid_stage");
      baseRepairSchema.parse(current.baseRepair);
      return run(tx,current,state,now);
    });
  }
  function requireAttempt(current:GenerationJob,token:string){
    const last=latestBaseAttempt(current);
    if(!last||last.token!==token)throw new GenerationError("invalid_stage");
    return last;
  }
  async function save(tx:GenerationTransaction,current:GenerationJob,state:Scheduler,attempt:BaseAttempt){
    const updated={...current,baseRepair:{...current.baseRepair!,phase:attempt.status==="saved"?"complete" as const:current.baseRepair!.phase,attempts:current.baseRepair!.attempts.map(a=>a.token===attempt.token?attempt:a)}};
    baseRepairSchema.parse(updated.baseRepair);
    await tx.putJob(updated);
    if(state.active)state.active.inflight=["started","unknown"].includes(attempt.status);
    await saveScheduler(tx,state);return updated;
  }
  async function authorize(tx:GenerationTransaction,current:GenerationJob,state:Scheduler,now:number){
    if(!options.enabled())throw new GenerationError("generation_disabled");
    if(state.pauseReason)throw new GenerationError("generation_paused");
    if(current.baseRepair?.phase!=="active")throw new GenerationError("invalid_stage");
    await checkStageBudget(tx,current.id,now,options.budgetUsd());
  }
  return {
    async reserveBaseAttempt(job:GenerationJob,reason:"transport"|"moderation"|"rate_limit"){
      const token=randomUUID();
      return withJob(job,async(tx,current,state,now)=>{
        const last=latestBaseAttempt(current);
        if(last?.status==="reserved"){
          if(last.reason!==reason)throw new GenerationError("invalid_stage");
          return {job:current,attempt:last};
        }
        if(!last||last.status!=="failed"||!last.failure||baseFailureRetryReason(last.failure)!==reason||last.ordinal>=current.baseRepair!.maxAttempts)throw new GenerationError("invalid_stage");
        await authorize(tx,current,state,now);
        const retryAt=last.failure.retryAt?Date.parse(last.failure.retryAt):0;
        const attempt:BaseAttempt={ordinal:last.ordinal+1,token,reason,status:"reserved",reservedAt:now,notBefore:Math.max(now+5000,retryAt)};
        const updated={...current,baseRepair:{...current.baseRepair!,attempts:[...current.baseRepair!.attempts,attempt]}};
        baseRepairSchema.parse(updated.baseRepair);await tx.putJob(updated);
        if(state.active)state.active.inflight=false;
        await saveScheduler(tx,state);return {job:updated,attempt};
      });
    },
    async startBaseAttempt(job:GenerationJob,token:string){
      return withJob(job,async(tx,current,state,now)=>{
        const attempt=requireAttempt(current,token);
        if(attempt.status!=="reserved"||attempt.notBefore>now||current.stages.length!==1||current.stages[0].name!=="base"||current.stages[0].status!=="inflight")throw new GenerationError("invalid_stage");
        await authorize(tx,current,state,now);
        const decisionTime=options.now();
        await requireJobWithActiveWorkerLease(tx,state,job,decisionTime);
        if(!options.enabled())throw new GenerationError("generation_disabled");
        if(moscowDay(decisionTime)!==moscowDay(now))await checkStageBudget(tx,current.id,decisionTime,options.budgetUsd());
        return save(tx,current,state,{...attempt,status:"started",startedAt:decisionTime});
      });
    },
    async saveBaseAttempt(job:GenerationJob,token:string,bytes:Buffer,metadata:{usage?:ImageUsage;generationMs:number}){
      if(!bytes.length||bytes.length>8*1024*1024)throw new GenerationError("invalid_provider_result");
      const sha256=hash(bytes);
      return withJob(job,async(tx,current,state,now)=>{
        const attempt=requireAttempt(current,token);
        if(attempt.status==="saved"){
          if(attempt.resultSha256!==sha256)throw new GenerationError("stage_conflict");
          return current;
        }
        if(attempt.status!=="started"||current.stages.length!==1||current.stages[0].name!=="base"||current.stages[0].status!=="inflight")throw new GenerationError("invalid_stage");
        await tx.putArtifact(current.id,"stage-base.png",bytes,current.expiresAt);
        await recordStageCost(tx,current.id,now,metadata.usage,"base");
        const result={usage:metadata.usage,generationMs:metadata.generationMs};
        return save(tx,{...current,stages:[{...current.stages[0],...result,status:"completed",sha256}]},state,{...attempt,...result,status:"saved",finishedAt:now,resultSha256:sha256});
      });
    },
    async failBaseAttempt(job:GenerationJob,token:string,error:GenerationError){
      return withJob(job,async(tx,current,state,now)=>{
        const attempt=requireAttempt(current,token);
        if(["failed","unknown"].includes(attempt.status))return current;
        if(attempt.status!=="started")throw new GenerationError("invalid_stage");
        const code=ANIMATION_ATTEMPT_FAILURE_CODES.find(code=>code===error.code)??"outcome_unknown";
        const reason=baseFailureRetryReason(error),unknown=code==="outcome_unknown"&&!reason;
        await recordStageCost(tx,current.id,now,code==="outcome_unknown"||isOutputModerationFailure(error.providerFailure)?undefined:{costUsd:0},"base");
        const failure={code,...(z.iso.datetime().safeParse(error.retryAt).success?{retryAt:error.retryAt}:{}),...(error.diagnostic?{diagnostic:error.diagnostic}:{}),...(error.cliCause?{cliCause:error.cliCause}:{}),...(error.providerFailure?{providerFailure:error.providerFailure}:{})};
        return save(tx,current,state,{...attempt,status:unknown?"unknown":"failed",finishedAt:now,generationMs:Math.max(0,now-attempt.startedAt!),failure,
          ...(reason==="rate_limit"?{usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:0}}:{})});
      });
    },
  };
}
