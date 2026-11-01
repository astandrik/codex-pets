import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {continuationFixture} from "./continuation-fixture.test-utils";
import {revisionFixture} from "./animation-revision-fixture.test-utils";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {GenerationError, jobSchema} from "./model";
import {initialAnimationRepair} from "./animation-repair";

afterEach(() => vi.unstubAllEnvs());

it("keeps automatic repair inside a newly selected revision and preserves the source", async () => {
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
  const f = await revisionFixture();
  const service = createGenerationService(f.store, {now: () => f.config.now, enabled: () => true,
    automaticAnimationRepair: () => true, secret: () => "synthetic-animation-revisions-secret"});
  const source = structuredClone(await f.store.readJob(f.source.id));
  const input = f.input(), accepted = await service.reviseAnimations(f.source.id, input, "203.0.113.25");
  const calls: string[] = [];
  const worker = createSpriteGenerationWorker({service, store: f.store, now: () => f.config.now,
    wait: async ms => {f.config.now += ms;}, renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {},
      generate: async name => {calls.push(name);return {bytes: f.base, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04}, generationMs: 1};},
      compose: async () => {if (calls.filter(n => n === "waving").length < 2) throw new GenerationError("invalid_sprite_extraction", undefined, undefined, undefined,
        {boundary: "renderer_process", reason: "invalid_image"}, undefined, undefined, [{state: "waving", kind: "invalid"}]);return f.atlas;},
    })}, build: async () => ({"pet.zip": Buffer.from("zip")})});
  expect(await worker("owner")).toBe("completed");
  expect(calls).toEqual(["idle", "waving", "waving"]);
  const child = (await f.store.readJob(accepted.generationId))!;
  expect(child.animationRepair?.maxAttempts).toBe(4);
  expect(child.animationRevision?.selectedStates).toEqual(["idle", "waving"]);
  expect(await f.store.readJob(f.source.id)).toEqual(source);
  expect(await f.store.readArtifact(child.id, "stage-base.png", f.config.now)).toEqual(f.base);
});

it("admits a selective continuation with frozen policy and does not charge replay", async () => {
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED", "true");
  const f = await continuationFixture(["waving"]), flag = {enabled: true};
  const service = createGenerationService(f.store, {now: () => f.config.now, enabled: () => true,
    automaticAnimationRepair: () => flag.enabled, secret: () => "continuation-test-secret"});
  const input = await f.input("regenerate", ["waving"]);
  const first = await service.continueGeneration(f.job.id, input, "203.0.113.26");
  flag.enabled = false;
  const again = await service.continueGeneration(f.job.id, input, "203.0.113.26");
  expect(again.generation!.generationId).toBe(first.generation!.generationId);
  const child = (await f.store.readJob(first.generation!.generationId))!;
  expect(child.animationRepair).toEqual(initialAnimationRepair());
  expect(child.continuation?.generationStages).toEqual(["waving"]);
  expect(f.store.jobs.size).toBe(2);
});

it("keeps the historical journal on free rebuild but never generates a paid row", async () => {
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED", "true");
  const f = await continuationFixture();
  const job = {...f.job, animationRepair: {...initialAnimationRepair(), phase: "stopped" as const, attempts: [{
    state: "idle" as const, ordinal: 1, token: randomUUID(), reason: "initial" as const, status: "saved" as const,
    reservedAt: f.config.now, notBefore: f.config.now, startedAt: f.config.now, finishedAt: f.config.now,
    resultSha256: f.job.stages.find(s => s.name === "idle")!.sha256, generationMs: 1,
  }]}};
  await f.store.transaction(tx => tx.putJob(job));
  await f.service.continueGeneration(job.id, await f.input("rebuild"), null);
  const queued = (await f.store.readJob(job.id))!;
  expect(jobSchema.safeParse(queued).success).toBe(true);
  const generate = vi.fn();
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.config.now,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, generate, compose: async () => f.image})},
    build: async () => ({"pet.zip": Buffer.from("zip")})});
  expect(await worker("owner")).toBe("completed");
  expect(generate).not.toHaveBeenCalled();
  expect((await f.store.readJob(job.id))!.animationRepair).toEqual(job.animationRepair);
});
