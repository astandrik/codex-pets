import {afterEach,expect,it,vi} from "vitest";
import {continuationFixture,failedAnimationRevisionFixture} from "./continuation-fixture.test-utils";
import {revisionFixture} from "./animation-revision-fixture.test-utils";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {changeSchedulerState} from "./scheduler-state";
import {type GenerationStore} from "./store";

afterEach(()=>vi.unstubAllEnvs());
async function activate(store:GenerationStore,now:number){
  const state=JSON.parse((await store.transaction(tx=>tx.getLedger("scheduler",now)))!);
  vi.stubEnv("PET_GENERATION_DRAIN","true");
  await changeSchedulerState(store,{action:"activate-tasks",expectedRevision:state.revision,now,apply:true});
  vi.stubEnv("PET_GENERATION_DRAIN","false");vi.stubEnv("PET_GENERATION_PROVIDER_CALLS","20");
}
it.each(["rebuild","regenerate"] as const)("preserves %s continuation input, receipt and snapshot",async mode=>{
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
  const f=await continuationFixture();const input=await f.input(mode,mode==="regenerate"?["waving"]:undefined);
  const accepted=await f.service.continueGeneration(f.job.id,input,"127.0.0.1");const id=accepted.generation!.generationId;
  await activate(f.store,f.config.now);vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","false");
  const calls:string[]=[];
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,
    renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>f.image,generate:async name=>{calls.push(name);return {bytes:f.image,generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}};}})},build:async()=>({"pet.zip":Buffer.from("zip")})});
  for(let n=0;n<30&&f.store.jobs.get(id)?.status!=="completed";n++){await Promise.all([run("a"),run("b")]);f.config.now+=250;}
  expect(f.store.jobs.get(id)?.status).toBe("completed");expect(calls).toEqual(mode==="rebuild"?[]:["waving"]);
  expect((await f.service.continueGeneration(f.job.id,input,null)).generation?.generationId).toBe(id);
});
it("preserves selected animation revisions and generates only their two rows",async()=>{
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED","true");
  const f=await revisionFixture(),input=f.input();
  const accepted=await f.service.reviseAnimations(f.source.id,input,"203.0.113.9");
  await activate(f.store,f.config.now);const calls:string[]=[];
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,
    renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>f.atlas,generate:async name=>{calls.push(name);return {bytes:f.base,generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.01}};}})},build:async()=>({"pet.zip":Buffer.from("zip")})});
  for(let n=0;n<20&&f.store.jobs.get(accepted.generationId)?.status!=="completed";n++){await Promise.all([run("a"),run("b")]);f.config.now+=250;}
  expect(f.store.jobs.get(accepted.generationId)?.status).toBe("completed");expect(calls.sort()).toEqual(["idle","waving"]);
  expect((await f.service.reviseAnimations(f.source.id,input,null)).generationId).toBe(accepted.generationId);
  expect(f.store.jobs.get(f.source.id)?.status).toBe("completed");
});
it("rejects a corrupt reused continuation strip before dispatching its missing row",async()=>{
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");
  const f=await failedAnimationRevisionFixture();const accepted=await f.service.continueGeneration(f.job.id,await f.input("regenerate",["waving"]),"127.0.0.1");
  const id=accepted.generation!.generationId;await activate(f.store,f.config.now);
  f.store.artifacts.set(`${id}:stage-idle.png`,{bytes:Buffer.from("corrupt"),expiresAt:f.config.now+86400000});
  let calls=0;const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,
    renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>f.image,generate:async()=>{calls++;return {bytes:f.image,generationMs:1};}})},build:async()=>({})});
  for(let n=0;n<10&&f.store.jobs.get(id)?.status!=="failed";n++){await run("a");f.config.now+=250;}
  expect(calls).toBe(0);expect(f.store.jobs.get(id)?.error).toBe("saved_stage_unavailable");
});
