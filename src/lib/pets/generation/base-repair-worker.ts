import {currentWorkerContext,setWorkerPhase} from "@/lib/pets/generation/worker-diagnostics";
import {readActiveWorkerJob, WorkerYield} from "@/lib/pets/generation/scheduler";
import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {GenerationError,type GenerationJob} from "@/lib/pets/generation/model";
import {latestBaseAttempt,baseFailureRetryReason} from "@/lib/pets/generation/base-repair";
import {recoverProviderIntent} from "@/lib/pets/generation/provider-intent-recovery";
import {recoverRetryReservation} from "@/lib/pets/generation/retry-reservation-recovery";
import type {createGenerationService} from "@/lib/pets/generation/service";
import type {GenerationStore} from "@/lib/pets/generation/store";
import type {SpriteSession,StageImage} from "@/lib/pets/generation/sprite-worker";
type Context={service:ReturnType<typeof createGenerationService>;store:GenerationStore;now:()=>number;wait:(ms:number)=>Promise<void>;checkLease:()=>void;beforeCall?:()=>void;mutate:<T>(run:()=>Promise<T>)=>Promise<T>;onTerminalFailure?:(name:"base")=>void};
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const uncertain=(boundary:"intent"|"checkpoint")=>new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary,reason:"unconfirmed_write"});
async function currentJob(context:Context,job:GenerationJob){
  return readActiveWorkerJob(context.store, job, context.now());
}
function pendingRetryFailure(job:GenerationJob){
  let failed=latestBaseAttempt(job);
  if(failed?.status==="reserved"&&failed.reason==="transport"){
    const ordinal=failed.ordinal-1;
    failed=job.baseRepair?.attempts.find(attempt=>attempt.ordinal===ordinal);
  }
  const maxAttempts=job.baseRepair?.maxAttempts;
  if(failed?.status!=="failed"||failed.failure?.code!=="outcome_unknown"||maxAttempts===undefined)return;
  const failure=failed.failure;
  if(failed.ordinal>=maxAttempts&&baseFailureRetryReason(failure)==="transport")return;
  return new GenerationError(failure.code,failure.retryAt,failure.providerFailure,undefined,failure.diagnostic,failure.cliCause);
}
export async function generateRepairBase(context:Context,job:GenerationJob,session:SpriteSession):Promise<StageImage>{
  let retryFailure=pendingRetryFailure(job);
  const beforeProviderCall=async<T>(run:()=>Promise<T>):Promise<T>=>{
    try{return await run();}
    catch(error){
      if(retryFailure&&job.expiresAt<=context.now()&&error instanceof GenerationError&&["generation_expired","stale_worker"].includes(error.code))throw retryFailure;
      throw error;
    }
  };
  while(true){
    const current=await beforeProviderCall(()=>currentJob(context,job)),attempt=latestBaseAttempt(current);
    retryFailure=pendingRetryFailure(current);
    if(!current.baseRepair||!attempt)throw uncertain("intent");
    if((attempt.status==="failed"||attempt.status==="unknown")&&attempt.failure){
      const failure=new GenerationError(attempt.failure.code,attempt.failure.retryAt,attempt.failure.providerFailure,undefined,attempt.failure.diagnostic,attempt.failure.cliCause);
      const reason=baseFailureRetryReason(failure);
      if(attempt.status==="unknown"||!reason||attempt.ordinal>=current.baseRepair.maxAttempts){
        if(attempt.status==="failed"&&reason==="transport")context.onTerminalFailure?.("base");
        throw failure;
      }
      await beforeProviderCall(async()=>{
        try{await context.mutate(()=>context.service.reserveBaseAttempt(job,reason));}
        catch(error){
          if(error instanceof GenerationError || error instanceof WorkerYield)throw error;
          await recoverRetryReservation(context.store,current,{kind:"base",stage:"base",reason},error,context.now);
        }
      });
      if(job.workerLeaseId)throw new WorkerYield(context.now()+5000);
      continue;
    }
    if(attempt.status!=="reserved")throw uncertain("intent");
    await beforeProviderCall(async()=>{
    const delay=Math.max(0,attempt.notBefore-context.now());if(delay&&job.workerLeaseId)throw new WorkerYield(attempt.notBefore);if(delay)await context.wait(delay);
    context.checkLease();
    setWorkerPhase(currentWorkerContext(), "intent", job, attempt.ordinal);
    try{await context.mutate(()=>{context.beforeCall?.();return context.service.startBaseAttempt(job,attempt.token);});}
    catch(error){
      if(error instanceof GenerationError||error instanceof WorkerYield)throw error;
      await recoverProviderIntent(context.store,job,"base",attempt.token,error,context.now);
    }
    context.checkLease();
    await currentJob(context,job);
    try{context.beforeCall?.();}catch(error){if(error instanceof WorkerYield)await context.mutate(()=>context.service.deferUnsentBaseAttempt(job,attempt.token));throw error;}
    });
    retryFailure=undefined;
    let image:StageImage;
    try{setWorkerPhase(currentWorkerContext(),"provider",job,attempt.ordinal);image=await session.generate("base",{attempt:attempt.ordinal});}
    catch(error){
      const failure=error instanceof GenerationError?error:new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"renderer_process",reason:"unclassified"});
      const terminal=attempt.ordinal>=current.baseRepair.maxAttempts&&baseFailureRetryReason(failure)==="transport";
      try{await context.mutate(()=>context.service.failBaseAttempt(job,attempt.token,failure));}
      catch(error){
        if(error instanceof GenerationError&&job.expiresAt<=context.now()){
          if(error===failure&&terminal)context.onTerminalFailure?.("base");
          throw error;
        }
        const recorded=await currentJob(context,job).then(latestBaseAttempt).catch(()=>undefined);
        const retryAt=failure.retryAt&&Number.isFinite(Date.parse(failure.retryAt))?failure.retryAt:undefined;
        if(recorded?.token!==attempt.token||recorded.ordinal!==attempt.ordinal||recorded.status!=="failed"||recorded.failure?.code!==failure.code||recorded.failure?.retryAt!==retryAt||
          !isDeepStrictEqual(recorded.failure?.diagnostic,failure.diagnostic)||!isDeepStrictEqual(recorded.failure?.cliCause,failure.cliCause)||!isDeepStrictEqual(recorded.failure?.providerFailure,failure.providerFailure))throw uncertain("checkpoint");
      }
      if(terminal)context.onTerminalFailure?.("base");
      // Reload the recorded failure before deciding whether another call is safe.
      retryFailure=failure.code==="outcome_unknown"?failure:undefined;
      continue;
    }
    try{await context.mutate(()=>context.service.saveBaseAttempt(job,attempt.token,image.bytes,image));}
    catch(error){
      if(error instanceof GenerationError&&error.code==="generation_expired")throw error;
      if(job.expiresAt<=context.now()){
        if(error instanceof GenerationError&&error.code==="stale_worker")throw error;
        throw uncertain("checkpoint");
      }
      const saved=await currentJob(context,job).then(latestBaseAttempt).catch(()=>undefined);
      const bytes=await context.store.readArtifact(job.id,"stage-base.png",context.now()).catch(()=>null);
      if(saved?.token!==attempt.token||saved.status!=="saved"||saved.resultSha256!==hash(image.bytes)||!bytes||hash(bytes)!==saved.resultSha256)throw uncertain("checkpoint");
    }
    return image;
  }
}
