import {createHash} from "node:crypto";
import {z} from "zod";
import {toPublicUrl} from "@/lib/base-path";
import {admitGeneration,type AdmissionOptions} from "@/lib/pets/generation/admission";
import {baseRetryEligibility,baseRetryInputSchema,digestSchema,type BaseRetryInput,type BaseRetryOptions,type BaseRetryReply} from "@/lib/pets/generation/base-retry-model";
import {GENERATION_INPUT_ARTIFACT,readGenerationInput,readSavedGenerationReference} from "@/lib/pets/generation/generation-input";
import {DAY,GENERATION_ID,GenerationError,generationDigest,moscowDay,withQueueTimeout,type GenerationJob,type GenerationInput} from "@/lib/pets/generation/model";
import {publicJob} from "@/lib/pets/generation/public-job";
import {scheduler} from "@/lib/pets/generation/scheduler";
import type {GenerationStore,GenerationTransaction} from "@/lib/pets/generation/store";

const receiptSchema=z.object({version:z.literal(1),requestId:z.uuid(),sourceId:digestSchema,targetId:digestSchema,fingerprint:digestSchema,createdAt:z.number().finite()}).strict();
type Receipt=z.infer<typeof receiptSchema>;
type Options=AdmissionOptions&{createId:()=>string;reviewFlow:()=>boolean};
class DayChanged extends Error {}
const version=(job:GenerationJob)=>createHash("sha256").update(JSON.stringify({id:job.id,status:job.status,error:job.error,providerFailure:job.providerFailure,expiresAt:job.expiresAt,baseConfirmedAt:job.baseConfirmedAt,base:job.stages.filter(s=>s.name==="base"),reference:job.reference,retryInput:job.retryInput,nameSource:job.nameSource,displayName:job.nameSource==="user"?job.displayName:undefined})).digest("hex");

export function createBaseRetryService(store:GenerationStore,options:Options){
  const requestKey=(id:string)=>"base-retry:request:"+generationDigest(options.secret(),"request",id);
  const sourceKey=(id:string)=>"base-retry:source:"+id;
  const validateId=(id:string)=>{if(!GENERATION_ID.test(id))throw new GenerationError("invalid_argument");};
  async function read(tx:GenerationTransaction,key:string){
    const raw=await tx.getLedger(key,options.now());if(!raw)return null;
    try{return receiptSchema.parse(JSON.parse(raw));}catch{throw new GenerationError("base_retry_unavailable");}
  }
  function source(record:GenerationJob|null){
    if(!record)throw new GenerationError("not_found");
    const job=withQueueTimeout(record,options.now());
    if(job.expiresAt<=options.now())throw new GenerationError("generation_expired");
    if(!baseRetryEligibility(job))throw new GenerationError("base_retry_unavailable");
    return job;
  }
  function guard(){
    if(!options.baseRetries())throw new GenerationError("base_retry_disabled");
    if(!options.reviewFlow())throw new GenerationError("generation_review_disabled");
    if(!options.enabled())throw new GenerationError("generation_disabled");
  }
  async function reply(tx:GenerationTransaction,r:Receipt,sourceId:string,requestId:string,reused:boolean):Promise<BaseRetryReply>{
    if(r.sourceId!==sourceId)throw new GenerationError("request_id_conflict");
    const job=await tx.getJob(r.targetId);
    if(!job||job.expiresAt<=options.now())throw new GenerationError("generation_expired");
    if(job.baseRetrySourceId!==sourceId)throw new GenerationError("base_retry_unavailable");
    const g=publicJob(job,options.now());
    return {requestId,sourceGenerationId:sourceId,reused,generation:{generationId:g.generationId,status:g.status,expiresAt:g.expiresAt,previewUrl:g.previewUrl}};
  }
  async function existing(tx:GenerationTransaction,id:string,requestId:string,fingerprint?:string){
    const own=await read(tx,requestKey(requestId));
    if(own){
      if(own.sourceId!==id||(fingerprint!==undefined&&own.fingerprint!==fingerprint))throw new GenerationError("request_id_conflict");
      return reply(tx,own,id,requestId,true);
    }
    const previous=await read(tx,sourceKey(id));
    return previous?reply(tx,previous,id,requestId,true):null;
  }
  return {
    async findBaseRetry(id:string,requestId:string){
      validateId(id);if(!z.uuid().safeParse(requestId).success)throw new GenerationError("invalid_argument");
      const result=await store.transaction(tx=>existing(tx,id,requestId));
      if(!result)throw new GenerationError("not_found");return result;
    },
    async getBaseRetryOptions(id:string):Promise<BaseRetryOptions>{
      validateId(id);
      return store.transaction(async tx=>{
        const previous=await read(tx,sourceKey(id));
        if(previous)return {existingGeneration:(await reply(tx,previous,id,previous.requestId,true)).generation};
        const job=source(await tx.getJob(id));
        const ref=await readSavedGenerationReference(job,tx.getArtifact,options.now);
        const input=job.retryInput?await readGenerationInput(job,tx.getArtifact,options.now):undefined;
        source(job);
        const blockedReason=!options.baseRetries()?"base_retry_disabled":!options.reviewFlow()?"generation_review_disabled":!options.enabled()?"generation_disabled":undefined;
        const displayName=input?.displayName??(job.nameSource==="user"?job.displayName:undefined);
        return {sourceRevision:version(job),sourceExpiresAt:new Date(job.expiresAt).toISOString(),inputState:input?"saved":"legacy",
          ...(input?{prompt:input.prompt}:{}),...(displayName!==undefined?{displayName}:{}),
          ...(ref?{referenceUrl:toPublicUrl(`/api/pet-generations/${id}/base-retries/reference?v=${ref.metadata.sha256}`)}:{}),
          availableModes:input?["saved"]:ref?["legacy-image-only","legacy-text"]:["legacy-text"],...(blockedReason?{blockedReason}:{})};
      });
    },
    async getBaseRetryReference(id:string,v:string){
      validateId(id);if(!digestSchema.safeParse(v).success)throw new GenerationError("invalid_argument");
      const loaded=await store.transaction(async tx=>{
        const job=source(await tx.getJob(id));
        if(job.reference?.sha256!==v)throw new GenerationError("base_retry_source_conflict");
        const ref=await readSavedGenerationReference(job,tx.getArtifact,options.now);
        if(!ref)throw new GenerationError("not_found");
        return {bytes:ref.bytes,revision:version(job)};
      });
      if(version(source(await store.readJob(id)))!==loaded.revision)throw new GenerationError("base_retry_source_conflict");
      return loaded.bytes;
    },
    async retryBaseGeneration(id:string,input:unknown,clientIp:string|null):Promise<BaseRetryReply>{
      validateId(id);const parsed=baseRetryInputSchema.safeParse(input);
      if(!parsed.success)throw new GenerationError("invalid_argument");
      const body=parsed.data;
      const fingerprint=generationDigest(options.secret(),"base-retry-body",JSON.stringify({sourceId:id,...body,requestId:undefined}));
      const targetId=options.createId();
      for(let attempt=0;attempt<3;attempt++){
        try {
          return await store.transaction(async tx=>{
            const found=await existing(tx,id,body.requestId,fingerprint);if(found)return found;
            guard();const job=source(await tx.getJob(id));
            if(version(job)!==body.sourceRevision)throw new GenerationError("base_retry_source_conflict");
            if((await scheduler(tx,options.now())).active?.id===id)throw new GenerationError("base_retry_unavailable");
            const ref=await readSavedGenerationReference(job,tx.getArtifact,options.now);
            const values=await restoredInput(job,body,tx);
            const now=options.now();
            await admitGeneration(tx,{id:targetId,input:{...values,requestId:body.requestId},reference:ref,reviewBase:true,acceptedAt:now,sourceDeadline:job.expiresAt,baseRetrySourceId:id},clientIp,options);
            const receipt:Receipt={version:1,requestId:body.requestId,sourceId:id,targetId,fingerprint,createdAt:now};
            const encoded=JSON.stringify(receipt);
            await tx.putLedger(requestKey(body.requestId),encoded,now+7*DAY);
            await tx.putLedger(sourceKey(id),encoded,now+7*DAY);
            guard();const current=source(await tx.getJob(id));
            if(version(current)!==body.sourceRevision)throw new GenerationError("base_retry_source_conflict");
            if(job.retryInput&&!await tx.hasArtifact(id,GENERATION_INPUT_ARTIFACT,options.now()))throw new GenerationError("base_retry_input_missing");
            if(ref&&!await tx.hasArtifact(id,"reference.png",options.now()))throw new GenerationError("saved_stage_unavailable");
            const result=await reply(tx,receipt,id,body.requestId,false);
            guard();
            // No awaited work may follow the final source/deadline/day decision.
            const decisionTime=options.now();
            if(job.expiresAt<=decisionTime)throw new GenerationError("generation_expired");
            if(moscowDay(now)!==moscowDay(decisionTime))throw new DayChanged();
            return result;
          });
        }catch(error){
          if(error instanceof GenerationError&&error.code==="request_id_conflict")throw error;
          // The transaction may have committed even if its acknowledgement was lost.
          const saved=await store.transaction(tx=>existing(tx,id,body.requestId,fingerprint)).catch(()=>null);
          if(saved)return saved;
          if(error instanceof DayChanged){if(attempt<2)continue;throw new GenerationError("generation_unavailable");}
          throw error;
        }
      }
      throw new GenerationError("generation_unavailable");
    },
  };
  async function restoredInput(job:GenerationJob,body:BaseRetryInput,tx:GenerationTransaction):Promise<Omit<GenerationInput,"requestId">>{
    if(job.retryInput){
      const saved=await readGenerationInput(job,tx.getArtifact,options.now);
      if(body.mode!=="saved")throw new GenerationError("base_retry_input_missing");
      return {prompt:saved.prompt,...(saved.displayName!==undefined?{displayName:saved.displayName}:{})};
    }
    if(body.mode==="saved"||(body.mode==="legacy-image-only"&&!job.reference))throw new GenerationError("base_retry_input_missing");
    return {prompt:body.mode==="legacy-text"?body.prompt:"",...(job.nameSource==="user"?{displayName:job.displayName}:{})};
  }
}
