import {expect,it} from "vitest";
import {baseRetryEligibility,baseRetryInputSchema} from "./base-retry-model";
import type {GenerationJob} from "./model";
const job:GenerationJob={id:"a".repeat(64),prompt:"",displayName:"pet",status:"failed",error:"provider_rejected",providerFailure:{httpStatus:400,code:"moderation_blocked",moderationStage:"output"},createdAt:0,expiresAt:100,worker:"",pipelineVersion:2,promptRevision:"test",reviewBase:true,stages:[{name:"base",status:"inflight",startedAt:1}]};
it("permits only definitive failed bases and never a saved/confirmed base",()=>{
 expect(baseRetryEligibility(job)).toBe(true);
 for(const patch of [{status:"generating"},{error:"outcome_unknown"},{baseConfirmedAt:1},{pipelineVersion:1},{providerFailure:{httpStatus:400,code:"moderation_blocked",moderationStage:"input"}},{stages:[{name:"base",status:"completed",startedAt:1}]}])expect(baseRetryEligibility({...job,...patch} as GenerationJob)).toBe(false);
 expect(baseRetryEligibility({...job,error:"provider_rate_limited",providerFailure:{httpStatus:429}})).toBe(true);
 expect(baseRetryEligibility({...job,error:"queue_timeout",providerFailure:undefined,stages:[]})).toBe(true);
 expect(baseRetryEligibility({...job,error:"queue_timeout",stages:[{name:"base",status:"inflight",startedAt:1}]})).toBe(false);
});
it("requires explicit saved or legacy mode, with no client asset paths",()=>{
 const common={requestId:"12345678-1234-4234-8234-123456789abc",sourceRevision:"f".repeat(64)};
 expect(baseRetryInputSchema.parse({...common,mode:"legacy-text",prompt:" x\r\ny "})).toMatchObject({prompt:"x\ny"});
 for(const input of [{...common},{...common,mode:"legacy-text",prompt:" "},{...common,mode:"saved",url:"https://bad.example"}])expect(baseRetryInputSchema.safeParse(input).success).toBe(false);
});
