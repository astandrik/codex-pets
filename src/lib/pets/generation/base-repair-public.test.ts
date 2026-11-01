import {randomUUID} from "node:crypto";
import {expect,it} from "vitest";
import {baseRepairSchema,jobSchema,type BaseAttempt} from "./model";
import {baseRepairProgressSchema,baseRepairProgressText} from "./base-repair-progress";
import {publicJob} from "./public-job";
import {parseHistoryGeneration} from "./history";
import {repairGenerationTotals} from "./animation-repair-worker";
import {baseRetryEligibility} from "./base-retry-model";
const failed=(ordinal:number):BaseAttempt=>({ordinal,token:randomUUID(),reason:ordinal===1?"initial":"moderation",status:"failed",reservedAt:1000,notBefore:1000,startedAt:1000,finishedAt:1000,failure:{code:"provider_rejected",providerFailure:{httpStatus:400,code:"moderation_blocked",moderationStage:"output"}}});
const base=()=>jobSchema.parse({id:"a".repeat(64),baseRetrySourceId:"c".repeat(64),reviewBase:true,prompt:"private",displayName:"Pet",worker:"owner",createdAt:0,expiresAt:100000,pipelineVersion:2,promptRevision:"test",status:"generating",stages:[{name:"base",status:"inflight",startedAt:1000}],baseRepair:{policy:1,maxAttempts:6,phase:"active",attempts:[failed(1),{ordinal:2,token:randomUUID(),reason:"moderation",status:"reserved",reservedAt:1000,notBefore:6000}]}});
it("exports exactly safe base progress in history and public responses",()=>{
 const job=base(),publicValue=publicJob(job,2000);
 expect(publicValue.baseRepair).toEqual({maxAttempts:6,attempts:2,phase:"active",retryAt:new Date(6000).toISOString()});
 expect(parseHistoryGeneration(publicValue,job.id)?.baseRepair).toEqual(publicValue.baseRepair);
 expect(JSON.stringify(publicValue)).not.toMatch(/token|private|providerFailure|notBefore|resultSha256/);
 expect(baseRepairProgressText(publicValue.baseRepair)).toContain("2 of 6");
 expect(baseRepairProgressText({...publicValue.baseRepair!,phase:"stopped"})).toContain("stopped");
 expect(baseRepairProgressText({...publicValue.baseRepair!,phase:"complete"})).toBeNull();
 expect(baseRepairProgressSchema.safeParse({...publicValue.baseRepair,prompt:"private"}).success).toBe(false);
});
it("validates maximum journal, unique tokens and contiguous terminal predecessors",()=>{
 const repair={policy:1,maxAttempts:51,phase:"stopped",attempts:Array.from({length:51},(_,i)=>failed(i+1))};
 expect(baseRepairSchema.safeParse(repair).success).toBe(true);
 for(const corrupt of [
  {...repair,maxAttempts:50},{...repair,attempts:[...repair.attempts,failed(52)]},
  {...repair,attempts:[failed(2)]},
  {...repair,attempts:[repair.attempts[0],{...failed(2),token:repair.attempts[0].token}]},
  {...repair,attempts:[{...failed(1),status:"unknown"},failed(2)]},
  {...repair,phase:"complete"},
 ])expect(baseRepairSchema.safeParse(corrupt).success).toBe(false);
});
it("rejects scope, duplicate old logs, mixed attempt reasons and inconsistent saved base",()=>{
 const job=base();
 for(const corrupt of [
  {...job,baseRetrySourceId:undefined},{...job,pipelineVersion:1},{...job,reviewBase:false},
  {...job,rowAttemptLogs:[{stage:"base",attempt:1,at:1000,code:"provider_rejected"}]},
  {...job,baseRepair:{...job.baseRepair,attempts:[failed(1),{...job.baseRepair!.attempts[1],reason:"transport"}]}},
  {...job,baseRepair:{...job.baseRepair,phase:"complete",attempts:[{...failed(1),status:"saved",failure:undefined,resultSha256:"b".repeat(64),generationMs:1}]}},
 ])expect(jobSchema.safeParse(corrupt).success).toBe(false);
});
it("does not count successful base cost twice, with or without animation repair",()=>{
 const usage={textInputTokens:1,imageInputTokens:2,outputTokens:3,costUsd:.04};
 const a={...failed(1),status:"saved" as const,failure:undefined,resultSha256:"b".repeat(64),generationMs:7,usage};
 const job={...base(),stages:[{name:"base" as const,status:"completed" as const,startedAt:1000,sha256:a.resultSha256,usage,generationMs:7}],baseRepair:{policy:1 as const,maxAttempts:1,phase:"complete" as const,attempts:[a]}};
 expect(repairGenerationTotals(job)).toEqual({generationMs:7,usage});
 expect(repairGenerationTotals({...job,animationRepair:{policy:1,maxAttempts:4,phase:"initial",attempts:[],pending:[],issues:[]}})).toEqual({generationMs:7,usage});
 expect(repairGenerationTotals({...job,baseRepair:{...job.baseRepair,attempts:[failed(1),{...a,ordinal:2,reason:"moderation"}]}})).toEqual({generationMs:7});
});
it("rejects malformed exhausted journal rather than creating a fresh child",()=>{
 const job={...base(),status:"failed" as const,error:"provider_rejected",providerFailure:failed(1).failure!.providerFailure,baseRepair:{policy:1 as const,maxAttempts:2,phase:"stopped" as const,attempts:[failed(1),failed(2)]}};
 expect(baseRetryEligibility(job)).toBe(true);
 expect(baseRetryEligibility({...job,baseRepair:{...job.baseRepair,attempts:[failed(2),failed(2)]}})).toBe(false);
 expect(baseRetryEligibility({...job,baseRepair:{...job.baseRepair,attempts:[failed(1),{...failed(2),reason:"transport"}]}})).toBe(false);
});
