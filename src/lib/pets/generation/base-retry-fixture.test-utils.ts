import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";
import {normalizeGenerationReference} from "./reference-image";
import {GenerationError} from "./model";

export async function baseRetryFixture(legacy=false,image=true){
  const store=new MemoryStore(),config={now:Date.parse("2026-11-01T12:00:00Z"),enabled:true,retry:!legacy,review:true,budget:50};
  const service=createGenerationService(store,{now:()=>config.now,enabled:()=>config.enabled,baseRetries:()=>config.retry,reviewFlow:()=>config.review,budgetUsd:()=>config.budget,secret:()=>"synthetic-base-retry-secret"});
  const reference=image?await normalizeGenerationReference(await sharp({create:{width:10,height:12,channels:4,background:"blue"}}).png().toBuffer(),"image/png"):undefined;
  await service.generate({requestId:randomUUID(),prompt:"Original input",displayName:"Pet name"},"203.0.113.8",{reviewBase:true,reference});
  const job=(await service.claim("first"))!;await service.beginStage(job,"base");
  const failure=new GenerationError("provider_rejected",undefined,{httpStatus:400,code:"moderation_blocked",moderationStage:"output"},undefined,{boundary:"provider_cli",reason:"process_exit"},{kind:"http_error",httpStatus:400});
  if(!legacy)await service.recordRowAttemptFailure(job,"base",1,failure);
  await service.fail(job,failure.code,failure.providerFailure,legacy?undefined:failure.diagnostic,[],legacy?[]:[{stage:"base",cause:failure.cliCause!}]);
  config.retry=true;
  const input=async(mode:"saved"|"legacy-image-only"|"legacy-text"="saved")=>{
    const options=await service.getBaseRetryOptions(job.id);
    if("existingGeneration" in options)throw Error("already retried");
    return {requestId:randomUUID(),sourceRevision:options.sourceRevision,mode,...(mode==="legacy-text"?{prompt:"Re-entered description"}:{})};
  };
  return {store,config,service,id:job.id,reference,input};
}
