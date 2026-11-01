import type {BaseAttempt,BaseRepairState,GenerationJob} from "@/lib/pets/generation/model";
import type {FailureDiagnostic} from "@/lib/pets/generation/failure-diagnostic";
import type {BaseRepairProgress} from "@/lib/pets/generation/base-repair-progress";
import {isRetryableImageCause,type CliCause} from "@/lib/pets/generation/cli-cause";
import {isOutputModerationFailure,type ProviderFailure} from "@/lib/pets/generation/provider-failure";
export function baseFailureRetryReason(failure:{code:string;cliCause?:CliCause;providerFailure?:ProviderFailure;diagnostic?:FailureDiagnostic}):"transport"|"moderation"|"rate_limit"|undefined {
  if(failure.diagnostic && failure.diagnostic.boundary!=="provider_cli")return undefined;
  if(failure.providerFailure && failure.cliCause && (failure.cliCause.kind!=="http_error" || failure.cliCause.httpStatus!==failure.providerFailure.httpStatus))return undefined;
  if(failure.code==="outcome_unknown"&&isRetryableImageCause(failure.cliCause))return "transport";
  if(failure.code==="provider_rejected"&&isOutputModerationFailure(failure.providerFailure))return "moderation";
  if(failure.code==="provider_rate_limited"&&failure.providerFailure?.httpStatus===429)return "rate_limit";
}
export const latestBaseAttempt=(job:GenerationJob):BaseAttempt|undefined=>job.baseRepair?.attempts.at(-1);
export function canResumeBaseRepair(job:GenerationJob):boolean {
  const repair=job.baseRepair,last=latestBaseAttempt(job);
  // A completed base journal is an audit, not permission to recover later animation work.
  if(!repair || repair.phase!=="active" || job.status!=="generating" || job.pipelineVersion!==2 ||
    !job.baseRetrySourceId || !job.reviewBase || job.baseConfirmedAt!==undefined || job.continuation || job.animationRevision ||
    job.stages.length!==1 || job.stages[0].name!=="base" || job.stages[0].status!=="inflight")return false;
  // Known failed calls may resume only to finalize; the worker separately decides retry eligibility.
  return Boolean(last && !repair.attempts.some(a=>["started","unknown"].includes(a.status)) &&
    (last.status==="reserved" || (last.status==="failed" && last.failure)));
}
export function reserveInitialBaseAttempt(job:GenerationJob,now:number,token:()=>string):GenerationJob {
  if(!job.baseRepair)return job;
  if(job.baseRepair.attempts.length)return job;
  return {...job,baseRepair:{...job.baseRepair,attempts:[{ordinal:1,token:token(),reason:"initial",status:"reserved",reservedAt:now,notBefore:now}]}};
}
export function getBaseRepairSummary(job:GenerationJob,now:number):BaseRepairProgress|undefined {
  const repair:BaseRepairState|undefined=job.baseRepair;if(!repair)return;
  const last=latestBaseAttempt(job);
  return {maxAttempts:repair.maxAttempts,attempts:repair.attempts.length,phase:job.status==="failed"&&repair.phase!=="complete"?"stopped":repair.phase,
    ...(last?.status==="reserved"&&last.notBefore>now?{retryAt:new Date(last.notBefore).toISOString()}:{})};
}

export function validBaseRepairSequence(repair:BaseRepairState):boolean {
  return Number.isInteger(repair.maxAttempts) && repair.maxAttempts>=1 && repair.maxAttempts<=51 &&
    repair.attempts.length<=repair.maxAttempts &&
    new Set(repair.attempts.map(a=>a.token)).size===repair.attempts.length &&
    repair.attempts.every((a,i)=>a.ordinal===i+1 && (i===0?a.reason==="initial":a.reason!=="initial") && (i===repair.attempts.length-1 || a.status==="failed") &&
      (i===0 || Boolean(repair.attempts[i-1].failure && baseFailureRetryReason(repair.attempts[i-1].failure!)===a.reason))) &&
    (repair.phase==="complete" ? repair.attempts.at(-1)?.status==="saved" : repair.attempts.at(-1)?.status!=="saved");
}
