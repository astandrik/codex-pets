import {afterEach, expect, it, vi} from "vitest";
import {revisionFixture} from "./animation-revision-fixture.test-utils";
import {createSpriteGenerationWorker, type SpriteRenderer} from "./sprite-worker";
import {LEASE_MS, jobSchema, type StageName} from "./model";

afterEach(() => vi.unstubAllEnvs());
it("runs only chosen stages from persisted snapshots, then requires free explicit acceptance", async () => {
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
  const f = await revisionFixture(); f.config.now = f.source.expiresAt - 60000;
  const child = await f.service.reviseAnimations(f.source.id, f.input(), "203.0.113.9");
  const stored = (await f.store.readJob(child.generationId))!;
  f.store.jobs.set(stored.id, jobSchema.parse(JSON.parse(JSON.stringify(stored))));
  const calls: StageName[] = [];
  const renderer: SpriteRenderer = {open: async (job, saved, reference, revisionAtlas) => {
    expect(job.animationRevision?.corrections.idle).toEqual(["Tilt without adding arms"]);
    expect(saved.get("base")).toEqual(f.base); expect(reference).toBeUndefined();
    expect(revisionAtlas).toEqual(f.files["spritesheet.webp"]);
    return {prepare: async () => undefined, generate: async name => {calls.push(name); return {bytes: f.base, generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 1, outputTokens: 1, costUsd: .1}};}, compose: async () => f.atlas, cleanup: async () => undefined};
  }};
  const provider = {prepare: async () => {throw Error("metadata must be copied");}, generate: vi.fn(() => {throw Error("metadata must be copied");})};
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "false");
  f.config.now = f.source.expiresAt + 1;
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.config.now, renderer, cardProvider: provider});
  expect(await worker("revision-owner")).toBe("completed"); expect(calls).toEqual(["idle", "waving"]);
  const pending = await f.service.get(child.generationId);
  expect(pending.progress).toEqual({completedSteps: 2, totalSteps: 2});
  expect(pending.pet?.zipUrl).toBeUndefined(); expect(pending.metadata?.editable).toBe(false);
  await expect(f.service.submit(child.generationId, null)).rejects.toMatchObject({code: "animation_revision_not_accepted"});
  await expect(f.service.editMetadata(child.generationId, {description:"Changed",tags:[],revision:0})).rejects.toMatchObject({code: "animation_revision_not_accepted"});
  const before = structuredClone([...f.store.ledger]);
  const accepted = await Promise.all([f.service.acceptAnimationRevision(child.generationId), f.service.acceptAnimationRevision(child.generationId)]);
  expect(accepted[0].animationRevision?.acceptedAt).toBe(accepted[1].animationRevision?.acceptedAt);
  expect(accepted[0].pet?.zipUrl).toContain("pet.zip"); expect([...f.store.ledger]).toEqual(before);
  expect(accepted[0].expiresAt).toBe(child.expiresAt);
});

it("rejects base and unselected stages, resumes a saved selected row without paying twice", async () => {
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
  const f = await revisionFixture(); const child = await f.service.reviseAnimations(f.source.id, f.input(), "203.0.113.9");
  const job = (await f.service.claim("first"))!;
  await expect(f.service.beginStage(job,"base")).rejects.toMatchObject({code:"invalid_stage"});
  await expect(f.service.beginStage(job,"running")).rejects.toMatchObject({code:"invalid_stage"});
  await f.service.beginStage(job,"idle"); await f.service.saveStage(job,"idle",f.base,{generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:.1}});
  f.config.now += LEASE_MS + 1;
  const calls: StageName[] = [];
  const renderer: SpriteRenderer = {open: async (_job,saved) => {
    expect(saved.has("idle")).toBe(true);
    return {prepare:async()=>undefined,generate:async name=>{calls.push(name);return {bytes:f.base,generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:.1}};},compose:async()=>f.atlas,cleanup:async()=>undefined};
  }};
  expect(await createSpriteGenerationWorker({service:f.service,store:f.store,renderer,now:()=>f.config.now})("second")).toBe("completed");
  expect(calls).toEqual(["waving"]); expect((await f.service.get(child.generationId)).progress.completedSteps).toBe(2);
});
it.each(["stage-base.png","revision-source.webp"])("rejects corrupt %s before opening provider", async kind => {
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
  const f = await revisionFixture(); const child = await f.service.reviseAnimations(f.source.id,f.input(),"203.0.113.9");
  f.store.artifacts.get(child.generationId+":"+kind)!.bytes=Buffer.from("corrupt");
  const renderer: SpriteRenderer={open:async()=>{throw Error("must not reach provider");}};
  expect(await createSpriteGenerationWorker({service:f.service,store:f.store,renderer,now:()=>f.config.now})("owner")).toBe("failed");
  expect((await f.service.get(child.generationId)).error?.code).toBe("saved_stage_unavailable");
});
