import {randomUUID} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {continuationFixture} from "./continuation-fixture.test-utils";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {jobSchema} from "./model";

afterEach(()=>vi.unstubAllEnvs());
it("preserves the completed base journal and its costs during a free same-job rebuild",async()=>{
 vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
 const f=await continuationFixture();
 const stage=f.job.stages[0];
 const source={...f.job,baseRetrySourceId:"c".repeat(64),generationMs:12,usage:{textInputTokens:12,imageInputTokens:12,outputTokens:12,costUsd:.12},
  stages:f.job.stages.map(stage=>({...stage,generationMs:1})),
  baseRepair:{policy:1 as const,maxAttempts:6,phase:"complete" as const,attempts:[{ordinal:1,token:randomUUID(),reason:"initial" as const,status:"saved" as const,reservedAt:f.config.now,notBefore:f.config.now,startedAt:f.config.now,finishedAt:f.config.now,resultSha256:stage.sha256!,generationMs:1,usage:stage.usage}]}};
 await f.store.transaction(tx=>tx.putJob(source));
 const input=await f.input("rebuild");const accepted=await f.service.continueGeneration(f.job.id,input,null);
 expect(accepted.generation!.generationId).toBe(source.id);
 const queued=jobSchema.parse(JSON.parse(JSON.stringify(await f.store.readJob(source.id))));
 expect(queued.baseRepair).toEqual(source.baseRepair);expect(queued.continuation?.mode).toBe("rebuild");
 expect(jobSchema.safeParse({...queued,baseRepair:{...queued.baseRepair,phase:"active"}}).success).toBe(false);
 expect(jobSchema.safeParse({...queued,baseRepair:{...queued.baseRepair,phase:"stopped"}}).success).toBe(false);
 let calls=0;
 const worker=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,renderer:{open:async()=>({prepare:async()=>undefined,cleanup:async()=>undefined,generate:async()=>{calls++;throw Error("rebuild must not generate");},compose:async()=>f.image})},build:async()=>({"pet.zip":Buffer.from("zip")})});
 expect(await worker("rebuild")).toBe("completed");expect(calls).toBe(0);
 const result=jobSchema.parse(JSON.parse(JSON.stringify(await f.store.readJob(source.id))));
 expect(result.baseRepair).toEqual(source.baseRepair);expect(result.usage?.costUsd).toBeCloseTo(.12);expect(result.generationMs).toBe(12);
});
