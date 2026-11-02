import {afterEach, expect, it, vi} from "vitest";
import {parallelFixture} from "./parallel-fixture.test-utils";
import {STAGE_NAMES} from "./model";
import {createGenerationWorker} from "./worker";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {buildCardMetadataRequest} from "./card-provider";
import {transitionScheduler} from "./scheduler-state";

afterEach(() => vi.unstubAllEnvs());
it("yields a legacy job without a call or pause when all eleven permits are occupied", async () => {
  const f = await parallelFixture();
  let a = (await f.service.claim("a"))!;
  await f.service.beginStage(a, "base"); await f.service.authorizeStage(a, "base");
  await f.service.saveStage(a, "base", Buffer.from("base"), {generationMs: 1});
  a = await f.service.beginStages(a, STAGE_NAMES.slice(1));
  for (const attempt of a.animationRepair!.attempts) await f.service.startAnimationAttempt(a, attempt.state, attempt.token);
  await f.store.transaction(async tx => {const b = (await tx.getJob(f.b.generationId))!; await tx.putJob({...b, pipelineVersion: 1, animationRepair: undefined});});
  let calls = 0;
  const worker = createGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    generate: async () => {calls++; return {bytes: Buffer.from("atlas"), generationMs: 1};}});
  expect(await worker("legacy")).toBe("yielded");
  expect(calls).toBe(0);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});

it.each(["expired", "missing"])("removes a %s resume ticket completely so a drained downgrade is possible", async kind => {
  const f = await parallelFixture(), a = (await f.service.claim("a"))!;
  await f.service.yield(a);
  if (kind === "expired") f.clock.now = a.expiresAt + 1;
  else {for (const id of [a.id, f.b.generationId, f.c.generationId]) f.store.jobs.delete(id); f.clock.now += 31 * 60_000;}
  await f.service.claim("cleanup");
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.resumes).toEqual({});
  expect(() => transitionScheduler(state, {action: "downgrade", expectedRevision: state.revision, now: f.clock.now})).not.toThrow();
});

it("releases a completed local operation after expiry without pausing unrelated provider work", async () => {
  const f = await parallelFixture(), a = (await f.service.claim("a"))!;
  await expect(f.service.withHeavy(a, async () => {f.clock.now = a.expiresAt + 1; return "finished";})).resolves.toBe("finished");
  await f.service.claim("cleanup");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({heavy: null});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});

it("serializes local assembly while another job can obtain a provider slot", async () => {
  const f = await parallelFixture(), a = (await f.service.claim("a"))!, b = (await f.service.claim("b"))!;
  let release!: () => void, entered!: () => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const held = new Promise<void>(resolve => {release = resolve;});
  const work = f.service.withHeavy(a, async () => {entered(); await held; return "a";});
  await started;
  try {
    await expect(f.service.withHeavy(b, async () => "b")).rejects.toMatchObject({name: "WorkerYield"});
    await f.service.beginStage(b, "base");
    await expect(f.service.authorizeStage(b, "base")).resolves.toBeUndefined();
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).heavy.jobId).toBe(a.id);
  } finally {release(); await work;}
  await expect(f.service.withHeavy(b, async () => "b")).resolves.toBe("b");
});

it.each(["compose", "authorize"])("does not start metadata after a stop during %s", async stopAt => {
  const f = await parallelFixture(); let stopped = false, calls = 0;
  f.store.jobs.delete(f.b.generationId); f.store.jobs.delete(f.c.generationId);
  await f.store.transaction(async tx => {
    const a = (await tx.getJob(f.a.generationId))!;
    await tx.putJob({...a, cardMetadata: {policy: 1, state: "pending", revision: 0, edited: false}});
  });
  if (stopAt === "authorize") {
    const original = f.service.authorizeCardMetadata;
    vi.spyOn(f.service, "authorizeCardMetadata").mockImplementation(async job => {await original(job); stopped = true;});
  }
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now, stopping: () => stopped,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {},
      compose: async () => {if (stopAt === "compose") stopped = true; return Buffer.from("atlas");},
      generate: async name => ({bytes: Buffer.from(name), generationMs: 1})})},
    cardProvider: {prepare: async job => buildCardMetadataRequest(job, Array(4).fill("data:image/png;base64,AA==")), generate: async () => {
      calls++; return {fields: {description: "Test", tags: []}, responseHash: "b".repeat(64), costUsd: 0, inputTokens: 0, outputTokens: 0};
    }}, build: async () => ({})});
  let result = "";
  for (let i = 0; i < 8 && !stopped; i++) result = await worker("one-process");
  expect(result).toBe("yielded"); expect(calls).toBe(0);
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.providerSlots).toEqual([]); expect(state.pauseReason).toBeUndefined();
});
