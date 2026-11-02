import {afterEach, expect, it, vi} from "vitest";
import {parallelFixture} from "./parallel-fixture.test-utils";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {GenerationError, LEASE_MS} from "./model";

afterEach(() => vi.unstubAllEnvs());

it("keeps a slow local operation fenced without financially pausing the queue, then recovers it", async () => {
  const f = await parallelFixture(), a = (await f.service.claim("old"))!;
  let entered!: () => void, finish!: () => void;
  const enteredPromise = new Promise<void>(resolve => {entered = resolve;});
  const completion = new Promise<void>(resolve => {finish = resolve;});
  const work = f.service.withHeavy(a, async () => {entered(); await completion;});
  await enteredPromise;
  try {
    f.clock.now += LEASE_MS + 1;
    expect((await f.service.claim("peer"))?.id).toBe(f.b.generationId);
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).heavy.jobId).toBe(a.id);
  } finally {finish(); await work;}
  expect((await f.service.claim("after"))?.id).toBe(f.c.generationId);
});

it("records uncertain spending when a worker is lost after provider authorisation", async () => {
  const f = await parallelFixture(), a = (await f.service.claim("old"))!;
  await f.service.beginStage(a, "base"); await f.service.authorizeStage(a, "base");
  const before = JSON.parse(f.store.ledger.get("budget")!.value);
  f.clock.now += LEASE_MS + 1;
  expect(await f.service.claim("replacement")).toBeNull();
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.reservations[a.id].unknown).toBe(true);
  expect(budget.spent).toEqual(before.spent);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toHaveLength(1);
});

it.each(["base", "animations"])("does not send a %s request after stop arrives during authorisation", async phase => {
  const f = await parallelFixture(); let stopped = false, sentAfterStop = 0;
  const calls = new Map<string, number>();
  f.store.jobs.delete(f.b.generationId); f.store.jobs.delete(f.c.generationId);
  const quotaBefore = [...f.store.ledger].filter(([key]) => !["budget", "scheduler"].includes(key) && !key.startsWith("generation-results:"));
  const originalJob = (await f.store.readJob(f.a.generationId))!;
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now, stopping: () => stopped,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("atlas"),
      generate: async name => {if (stopped) sentAfterStop++; calls.set(name, (calls.get(name) ?? 0) + 1); return {bytes: Buffer.from(name), generationMs: 1, usage: {textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: .01}};}})},
    build: async () => ({})});
  if (phase === "animations") await worker("base");
  if (phase === "base") {
    const original = f.service.authorizeStage;
    vi.spyOn(f.service, "authorizeStage").mockImplementation(async (...args) => {await original(...args); stopped = true;});
  } else {
    const original = f.service.startAnimationAttempt;
    vi.spyOn(f.service, "startAnimationAttempt").mockImplementation(async (...args) => {const result = await original(...args); stopped = true; return result;});
  }
  expect(await worker("interrupted")).toBe("yielded");
  expect(sentAfterStop).toBe(0);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toEqual([]);
  const job = (await f.store.readJob(f.a.generationId))!;
  expect(job.id).toBe(f.a.generationId);
  expect(job.animationRepair!.attempts.every(a => a.status === "reserved")).toBe(true);
  vi.restoreAllMocks(); stopped = false;
  for (let i = 0; i < 4 && (await f.store.readJob(job.id))?.status !== "completed"; i++) await worker("resumed");
  expect(await f.store.readJob(job.id)).toMatchObject({status: "completed", createdAt: originalJob.createdAt, expiresAt: originalJob.expiresAt});
  expect(f.store.jobs.size).toBe(1); expect([...calls.values()]).toEqual(Array(12).fill(1));
  expect([...f.store.ledger].filter(([key]) => !["budget", "scheduler"].includes(key) && !key.startsWith("generation-results:"))).toEqual(quotaBefore);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(120000);
});

it("preserves the second transport failure instead of starting a third retry", async () => {
  const f = await parallelFixture(); f.store.jobs.delete(f.b.generationId); f.store.jobs.delete(f.c.generationId);
  let calls = 0;
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("atlas"),
      generate: async () => {calls++; throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
        {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});}})}});
  expect(await worker("first")).toBe("yielded");
  const retryToken = (await f.store.readJob(f.a.generationId))!.rowRetries![0].token;
  f.clock.now += 5001;
  expect(await worker("second")).toBe("failed");
  const job = (await f.store.readJob(f.a.generationId))!;
  expect(calls).toBe(2); expect(job.rowAttemptLogs).toHaveLength(2);
  expect(job.rowRetries![0].token).toBe(retryToken);
  expect(job.error).toBe("outcome_unknown");
  expect(job.failureDiagnostic).toMatchObject({boundary: "provider_cli", reason: "process_exit"});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
});

it("returns an unsent transport retry to waiting without replacing its token", async () => {
  const f = await parallelFixture(); let stopped = false, baseCalls = 0;
  f.store.jobs.delete(f.b.generationId); f.store.jobs.delete(f.c.generationId);
  const worker = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now, stopping: () => stopped,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("atlas"),
      generate: async name => {
        if (name === "base" && ++baseCalls === 1) throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
          {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});
        return {bytes: Buffer.from(name), generationMs: 1};
      }})}, build: async () => ({})});
  expect(await worker("first")).toBe("yielded"); f.clock.now += 5001;
  const token = (await f.store.readJob(f.a.generationId))!.rowRetries![0].token;
  const authorize = f.service.authorizeRowRetry;
  vi.spyOn(f.service, "authorizeRowRetry").mockImplementation(async (...args) => {await authorize(...args); stopped = true;});
  expect(await worker("cancelled")).toBe("yielded"); expect(baseCalls).toBe(1);
  expect((await f.store.readJob(f.a.generationId))!.rowRetries![0]).toMatchObject({token, state: "waiting"});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toEqual([]);
  vi.restoreAllMocks(); stopped = false;
  for (let i = 0; i < 4 && (await f.store.readJob(f.a.generationId))?.status !== "completed"; i++) await worker("resumed");
  expect(baseCalls).toBe(2);
  expect(await f.store.readJob(f.a.generationId)).toMatchObject({status: "completed"});
});
