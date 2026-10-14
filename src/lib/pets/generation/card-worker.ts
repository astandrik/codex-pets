import {GenerationError,type GenerationJob} from "@/lib/pets/generation/model";
import type {GenerationCardProvider} from "@/lib/pets/generation/card-provider";
import type {createGenerationService} from "@/lib/pets/generation/service";
import type {GenerationStore} from "@/lib/pets/generation/store";

type Service=ReturnType<typeof createGenerationService>;
export async function prepareGeneratedCard(job:GenerationJob,source:Buffer,service:Service,store:GenerationStore,provider:GenerationCardProvider|undefined,checkLease:()=>void):Promise<GenerationJob>{
  if(!job.cardMetadata||["completed","failed"].includes(job.cardMetadata.state))return job;
  const owner=job.worker;
  if(job.cardMetadata.state==="inflight")return service.failCardMetadata(job,"outcome_unknown");
  if(!provider)return service.failCardMetadata(job,"metadata_unavailable");
  let request;
  try{request=await provider.prepare(job,source);}catch{return service.failCardMetadata(job,"metadata_unavailable");}
  checkLease();
  try{job=await service.beginCardMetadata(job,request.requestHash);}
  catch(error){
    if(error instanceof GenerationError){
      if(error.code==="budget_exhausted"||error.code==="generation_disabled")return service.failCardMetadata(job,error.code);
      throw error;
    }
    const saved=await store.readJob(job.id);
    if(saved?.worker!==owner)throw new GenerationError("stale_worker");
    if(saved.status!=="processing"||saved.cardMetadata?.state!=="inflight"||saved.cardMetadata.requestHash!==request.requestHash)return service.failCardMetadata(job,"outcome_unknown");
    job=saved;
  }
  try{
    checkLease();await service.authorizeCardMetadata(job);
    const response=await provider.generate(request);
    try{return await service.saveCardMetadata(job,response);}
    catch{
      const saved=await store.readJob(job.id);
      if(saved?.worker!==owner)throw new GenerationError("stale_worker");
      if(saved.cardMetadata?.state==="completed"&&saved.cardMetadata.responseHash===response.responseHash)return saved;
      return service.failCardMetadata(job,"outcome_unknown");
    }
  }catch(error){
    if(error instanceof GenerationError&&error.code==="stale_worker")throw error;
    const known=error instanceof GenerationError&&["provider_rejected","metadata_unavailable","budget_exhausted","generation_disabled"].includes(error.code);
    return service.failCardMetadata(job,known?error.code:"outcome_unknown");
  }
}
