import {createHash} from "node:crypto";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {continuationFixture} from "./continuation-fixture.test-utils";
import {createSpriteGenerationWorker,type SpriteRenderer,type SpriteSession} from "./sprite-worker";
import {GenerationError,LEASE_MS} from "./model";

beforeEach(()=>vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true"));
afterEach(()=>vi.unstubAllEnvs());
function renderer(bytes:Buffer){
  const generate=vi.fn<SpriteSession["generate"]>(async()=>({bytes,generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:.1}}));
  const compose=vi.fn(async()=>bytes);
  const open=vi.fn<SpriteRenderer['open']>(async()=>({generate,compose,prepare:async()=>{},cleanup:async()=>{}}));
  return {generate,compose,open};
}
it("rebuild calls no image stage and finishes without another daily attempt",async()=>{
  const f=await continuationFixture(),r=renderer(f.image);await f.service.continueGeneration(f.job.id,await f.input("rebuild"),"127.0.0.1");
  const worker=createSpriteGenerationWorker({service:f.service,store:f.store,renderer:r,now:()=>f.config.now,build:async()=>({"pet.zip":Buffer.from("zip")})});
  expect(await worker("worker")).toBe("completed");expect(r.generate).not.toHaveBeenCalled();expect(r.compose).toHaveBeenCalledOnce();
  expect(f.store.jobs.get(f.job.id)?.status).toBe("completed");expect(f.store.ledger.has("day:2026-10-22")).toBe(false);
});
it("runs only two missing rows after restart, parent expiry and admission flag-off",async()=>{
  const f=await continuationFixture(["running-right","look-0-157"]);f.config.now=f.job.expiresAt-60_000;
  const response=await f.service.continueGeneration(f.job.id,await f.input("regenerate",["running-right","look-0-157"]),"127.0.0.1");
  const id=response.generation!.generationId;
  f.config.now=f.job.expiresAt+1;await f.store.cleanup(f.config.now);vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","false");
  const r=renderer(f.image);const worker=createSpriteGenerationWorker({service:f.service,store:f.store,renderer:r,now:()=>f.config.now,build:async()=>({"pet.zip":Buffer.from("zip")})});
  expect(await worker("after-restart")).toBe("completed");expect(r.generate.mock.calls.map(c=>c[0])).toEqual(["running-right","look-0-157"]);
  expect(r.open.mock.calls[0][1].get("base")).toEqual(f.image);expect(f.store.jobs.get(id)?.status).toBe("completed");
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-10-23"]).toBe(200000);
});
it("never repeats an already committed generated row after a worker restart",async()=>{
  const f=await continuationFixture(["running-right"]);await f.service.continueGeneration(f.job.id,await f.input("regenerate",["running-right"]),"127.0.0.1");
  let job=(await f.service.claim("one"))!;job=await f.service.beginStage(job,"running-right");await f.service.saveStage(job,"running-right",f.image,{generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:.1}});
  f.config.now+=LEASE_MS+1;const r=renderer(f.image);
  const worker=createSpriteGenerationWorker({service:f.service,store:f.store,renderer:r,now:()=>f.config.now,build:async()=>({"pet.zip":Buffer.from("zip")})});
  expect(await worker("two")).toBe("completed");expect(r.generate).not.toHaveBeenCalled();
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-10-22"]).toBe(100000);
});
it("the service independently rejects stages absent from the persisted plan",async()=>{
  const f=await continuationFixture(["running-right"]);await f.service.continueGeneration(f.job.id,await f.input("regenerate",["running-right"]),"127.0.0.1");
  const job=(await f.service.claim("one"))!;await expect(f.service.beginStage(job,"base")).rejects.toMatchObject({code:"invalid_stage"});
  await expect(f.service.beginStage(job,"waving")).rejects.toMatchObject({code:"stage_already_completed"});
});
it("persists safe assembly facts and does not forward a raw private message",async()=>{
  const f=await continuationFixture(),r=renderer(f.image);await f.service.continueGeneration(f.job.id,await f.input("rebuild"),"127.0.0.1");
  const issue={state:"running-right",kind:"sparse",frame:2,actual:10,expected:200};
  r.compose.mockRejectedValue(new GenerationError("invalid_sprite_extraction",undefined,undefined,undefined,undefined,undefined,undefined,[issue]));
  const worker=createSpriteGenerationWorker({service:f.service,store:f.store,renderer:r,now:()=>f.config.now});
  expect(await worker("one")).toBe("failed");expect(f.store.jobs.get(f.job.id)?.assemblyIssues).toEqual([issue]);
  expect((await f.service.getContinuationOptions(f.job.id)).requiredStates).toEqual(["running-right"]);
  expect(createHash("sha256").update(f.image).digest("hex")).toBe(f.store.jobs.get(f.job.id)?.stages[0].sha256);
});
it("continues a failed revision using its successful row, atlas and edited card, ready without acceptance",async()=>{
  const {failedAnimationRevisionFixture}=await import('./continuation-fixture.test-utils');
  const f=await failedAnimationRevisionFixture();
  const state=await f.service.getContinuationOptions(f.job.id);expect(state.requiredStates).toEqual(['waving']);
  const response=await f.service.continueGeneration(f.job.id,await f.input('regenerate',['waving']),'127.0.0.1');
  const r=renderer(f.image);r.compose.mockResolvedValue(f.atlas);
  const worker=createSpriteGenerationWorker({service:f.service,store:f.store,renderer:r,now:()=>f.config.now});
  expect(await worker('revision-recovery')).toBe('completed');expect(r.generate.mock.calls.map(c=>c[0])).toEqual(['waving']);
  expect(r.open.mock.calls[0][1].get('idle')).toEqual(f.image);expect(r.open.mock.calls[0][3]).toEqual(f.atlas);
  const child=f.store.jobs.get(response.generation!.generationId)!;
  expect(child.cardMetadata).toMatchObject(f.job.cardMetadata!);expect(child.continuation?.corrections).toEqual(f.job.animationRevision?.corrections);expect(child.animationRevision).toBeUndefined();
  expect(await f.store.readArtifact(child.id,'pet.zip',f.config.now)).not.toBeNull();expect(f.store.jobs.get(f.job.id)?.status).toBe('failed');
});
it.each(['stage-base.png','stage-idle.png','continuation-source.webp'])('rejects a corrupt private snapshot %s before any provider call',async kind=>{
  const {failedAnimationRevisionFixture}=await import('./continuation-fixture.test-utils');const f=await failedAnimationRevisionFixture();
  const response=await f.service.continueGeneration(f.job.id,await f.input('regenerate',['waving']),'127.0.0.1');const id=response.generation!.generationId;
  f.store.artifacts.set(id+':'+kind,{bytes:Buffer.from('corrupt'),expiresAt:f.config.now+86400000});const r=renderer(f.image);
  const worker=createSpriteGenerationWorker({service:f.service,store:f.store,renderer:r,now:()=>f.config.now});
  expect(await worker('corrupt-copy')).toBe('failed');expect(r.open).not.toHaveBeenCalled();expect(r.generate).not.toHaveBeenCalled();expect(f.store.jobs.get(id)?.error).toBe('saved_stage_unavailable');
});
