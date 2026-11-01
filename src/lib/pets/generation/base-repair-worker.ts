import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import {GenerationError,type GenerationJob} from "@/lib/pets/generation/model";
import {latestBaseAttempt,baseFailureRetryReason} from "@/lib/pets/generation/base-repair";
import type {createGenerationService} from "@/lib/pets/generation/service";
import type {GenerationStore} from "@/lib/pets/generation/store";
import type {SpriteSession,StageImage} from "@/lib/pets/generation/sprite-worker";
type Context={service:ReturnType<typeof createGenerationService>;store:GenerationStore;now:()=>number;wait:(ms:number)=>Promise<void>;checkLease:()=>void;mutate:<T>(run:()=>Promise<T>)=>Promise<T>;onTerminalFailure?:(name:"base")=>void};
const hash=(bytes:Buffer)=>createHash("sha256").update(bytes).digest("hex");
const uncertain=(boundary:"intent"|"checkpoint")=>new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary,reason:"unconfirmed_write"});
async function currentJob(context:Context,job:GenerationJob){
  const current=await context.store.readJob(job.id);
  if(!current||current.worker!==job.worker)throw new GenerationError("stale_worker");
  if(current.expiresAt<=context.now())throw new GenerationError("generation_expired");
  if(!current.leaseUntil||current.leaseUntil<=context.now())throw new GenerationError("stale_worker");
  return current;
}
function pendingRetryFailure(job:GenerationJob){
  let failed=latestBaseAttempt(job);
  if(failed?.status==="reserved"&&failed.reason==="transport"){
    const ordinal=failed.ordinal-1;
    failed=job.baseRepair?.attempts.find(attempt=>attempt.ordinal===ordinal);
  }
  if(failed?.status!=="failed"||failed.failure?.code!=="outcome_unknown")return;
  const failure=failed.failure;
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
      if(attempt.status==="unknown"||!reason||attempt.ordinal>=current.baseRepair.maxAttempts)throw failure;
      try{await beforeProviderCall(()=>context.mutate(()=>context.service.reserveBaseAttempt(job,reason)));}
      catch(error){
        if(error instanceof GenerationError)throw error;
        const saved=await currentJob(context,job).then(latestBaseAttempt).catch(()=>undefined);
        if(!saved||saved.status!=="reserved"||saved.ordinal!==attempt.ordinal+1||saved.reason!==reason)throw uncertain("intent");
      }
      continue;
    }
    if(attempt.status!=="reserved")throw uncertain("intent");
    await beforeProviderCall(async()=>{
      const delay=Math.max(0,attempt.notBefore-context.now());if(delay)await context.wait(delay);
      context.checkLease();
      try{await context.mutate(()=>context.service.startBaseAttempt(job,attempt.token));}
      catch(error){if(error instanceof GenerationError)throw error;throw uncertain("intent");}
      context.checkLease();
      await currentJob(context,job);
    });
    retryFailure=undefined;
    let image:StageImage;
    try{image=await session.generate("base",{attempt:attempt.ordinal});}
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
