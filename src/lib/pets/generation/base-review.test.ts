import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {MemoryStore} from "./test-store";
import {STAGE_NAMES, type StageName} from "./model";

afterEach(() => vi.unstubAllEnvs());

function fixture() {
  const store = new MemoryStore();
  const config = {now: Date.parse("2026-10-17T10:00:00Z"), enabled: true};
  const service = createGenerationService(store, {now: () => config.now, enabled: () => config.enabled, secret: () => "synthetic-review-secret-at-least-32-characters"});
  const generate = vi.fn(async (name: StageName) => ({bytes: Buffer.from(name), usage: {textInputTokens: 1, imageInputTokens: 1, outputTokens: 1, costUsd: .1}, generationMs: 1}));
  const cleanup = vi.fn(async () => undefined);
  const worker = createSpriteGenerationWorker({service, store, now: () => config.now, renderer: {open: async () => ({prepare: async () => undefined, generate, compose: async () => Buffer.from("atlas"), cleanup})}, build: async () => ({"pet.zip": Buffer.from("zip")})});
  const input = () => ({prompt: "Synthetic fox", requestId: randomUUID()});
  return {store, config, service, generate, cleanup, worker, input};
}

describe("website base review", () => {
  it("stops before animations, releases the worker, then resumes the same base without charging another attempt", async () => {
    const f = fixture();
    const accepted = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
    expect(await f.worker("owner")).toBe("awaiting_confirmation");
    expect(f.generate.mock.calls.map(([name]) => name)).toEqual(["base"]);
    expect(await f.service.get(accepted.generationId)).toMatchObject({status: "awaiting_confirmation", progress: {completedSteps: 1, totalSteps: 12}});
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).active).toBeNull();
    expect(f.cleanup).toHaveBeenCalledOnce();
    const counts = [...f.store.ledger].filter(([key]) => key.startsWith("ip:") || key.startsWith("day:"));
    const confirm = await f.service.confirm(accepted.generationId);
    expect(confirm.newlyQueued).toBe(true);
    expect((await f.service.confirm(accepted.generationId)).newlyQueued).toBe(false);
    expect(await f.worker("next-owner")).toBe("completed");
    expect(f.generate.mock.calls.map(([name]) => name)).toEqual([...STAGE_NAMES]);
    expect([...f.store.ledger].filter(([key]) => key.startsWith("ip:") || key.startsWith("day:"))).toEqual(counts);
  });

  it("preserves the automatic MCP/legacy flow", async () => {
    const f = fixture();
    await f.service.generate(f.input(), "203.0.113.5");
    expect(await f.worker("owner")).toBe("completed");
    expect(f.generate).toHaveBeenCalledTimes(12);
  });
});

it("does not block other jobs while a character is under review", async () => {
  const f = fixture();
  const first = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  await f.worker("one");
  const other = await f.service.generate(f.input(), "203.0.113.6");
  expect(await f.worker("two")).toBe("completed");
  expect((await f.service.get(first.generationId)).status).toBe("awaiting_confirmation");
  expect((await f.service.get(other.generationId)).status).toBe("completed");
});

it("blocks rows at the service boundary before approval and recovers a saved base after a crash", async () => {
  const f = fixture();
  await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  const job = (await f.service.claim("crashed"))!;
  await f.service.beginStage(job, "base");
  await f.service.saveStage(job, "base", Buffer.from("base"), {generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .1}});
  await expect(f.service.beginStages(job, [...STAGE_NAMES.slice(1)])).rejects.toMatchObject({code: "base_not_ready"});
  f.config.now += 11 * 60_000;
  expect(await f.worker("recovery")).toBe("awaiting_confirmation");
  expect(f.generate).not.toHaveBeenCalled();
});

it("recovers lost pause and confirmation acknowledgements without replaying work", async () => {
  const f = fixture();
  const accepted = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  const pause = f.service.awaitConfirmation;
  vi.spyOn(f.service, "awaitConfirmation").mockImplementationOnce(async job => {await pause(job); throw Error("lost ack");});
  expect(await f.worker("one")).toBe("awaiting_confirmation");
  const transaction = f.store.transaction.bind(f.store);
  const spy = vi.spyOn(f.store, "transaction").mockImplementationOnce(async operation => {await transaction(operation); throw Error("lost commit ack");});
  const result = await f.service.confirm(accepted.generationId);
  expect(result.newlyQueued).toBe(false); spy.mockRestore();
  const results = await Promise.all(Array.from({length: 8}, () => f.service.confirm(accepted.generationId)));
  expect(results.every(result => !result.newlyQueued)).toBe(true);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).queue).toEqual([accepted.generationId]);
  expect(await f.worker("two")).toBe("completed");
  expect(f.generate).toHaveBeenCalledTimes(12);
});

it("sets a new queue clock, preserves the deadline and never revives a timed-out continuation", async () => {
  const f = fixture(); const accepted = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  await f.worker("one"); f.config.now += 60 * 60_000;
  const queued = await f.service.confirm(accepted.generationId);
  expect(queued.generation.status).toBe("queued"); expect(queued.generation.expiresAt).toBe(accepted.expiresAt);
  f.config.now += 31 * 60_000;
  expect((await f.service.get(accepted.generationId)).status).toBe("queued");
  f.config.now += 29 * 60_000;
  expect((await f.service.get(accepted.generationId)).error?.code).toBe("queue_timeout");
  expect(await f.worker("two")).toBe("idle");
  const again = await f.service.confirm(accepted.generationId);
  expect(again.newlyQueued).toBe(false); expect(again.generation.status).toBe("failed");
  expect(f.generate).toHaveBeenCalledTimes(1);
});

it("keeps the character waiting when the queue, budget or service cannot accept animations", async () => {
  const f = fixture(); const accepted = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  await f.worker("one");
  f.config.enabled = false;
  await expect(f.service.confirm(accepted.generationId)).rejects.toMatchObject({code: "generation_disabled"});
  f.config.enabled = true;
  const scheduler = JSON.parse(f.store.ledger.get("scheduler")!.value);
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...scheduler, pauseReason: "outcome_unknown"});
  await expect(f.service.confirm(accepted.generationId)).rejects.toMatchObject({code: "generation_paused"});
  f.store.ledger.get("scheduler")!.value = JSON.stringify(scheduler);
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  f.store.ledger.get("budget")!.value = JSON.stringify({...budget, spent: {"2026-10-17": 50_000_000}});
  await expect(f.service.confirm(accepted.generationId)).rejects.toMatchObject({code: "budget_exhausted"});
  f.store.ledger.get("budget")!.value = JSON.stringify(budget);
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "5");
  for (let i = 0; i < 5; i++) await f.service.generate(f.input(), "203.0.113.6");
  await expect(f.service.confirm(accepted.generationId)).rejects.toMatchObject({code: "queue_full"});
  expect((await f.service.get(accepted.generationId)).status).toBe("awaiting_confirmation");
  expect((await f.store.readJob(accepted.generationId))?.baseConfirmedAt).toBeUndefined();
});

it("preserves unknown accounting across review and midnight without a second daily attempt", async () => {
  const f = fixture(); f.config.now = Date.parse("2026-10-17T20:50:00Z");
  const accepted = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  budget.reservations[accepted.generationId].unknown = true; f.store.ledger.get("budget")!.value = JSON.stringify(budget);
  await f.worker("one");
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[accepted.generationId].unknown).toBe(true);
  f.config.now += 20 * 60_000;
  await f.service.confirm(accepted.generationId);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[accepted.generationId].unknown).toBe(true);
  expect(f.store.ledger.has("day:2026-10-18")).toBe(false);
  expect(await f.worker("two")).toBe("completed");
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent).toEqual({"2026-10-17": 100000, "2026-10-18": 1100000});
});

it("expires private base and confirmation together and does not expose the raw input", async () => {
  const f = fixture(); const accepted = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  await f.worker("one"); expect(await f.service.getBase(accepted.generationId)).toEqual(Buffer.from("base"));
  expect(JSON.stringify(await f.service.get(accepted.generationId))).not.toContain("Synthetic fox");
  f.config.now += 86400000;
  await expect(f.service.getBase(accepted.generationId)).rejects.toMatchObject({code: "generation_expired"});
  await expect(f.service.confirm(accepted.generationId)).rejects.toMatchObject({code: "generation_expired"});
  expect(f.generate).toHaveBeenCalledTimes(1);
});

it("drains a pending heartbeat before releasing the review lease", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture(); await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
    let release!: () => void;
    const gate = new Promise<void>(resolve => {release = resolve;});
    const heartbeat = f.service.heartbeat;
    vi.spyOn(f.service, "heartbeat").mockImplementation(async job => {await gate; return heartbeat(job);});
    const pause = vi.spyOn(f.service, "awaitConfirmation");
    const image = f.generate.getMockImplementation()!;
    f.generate.mockImplementationOnce(async name => {await vi.advanceTimersByTimeAsync(30000); return image(name);});
    const running = f.worker("one");
    await vi.waitFor(() => expect(f.service.heartbeat).toHaveBeenCalledOnce());
    expect(pause).not.toHaveBeenCalled();
    release(); expect(await running).toBe("awaiting_confirmation");
    expect(pause).toHaveBeenCalledOnce();
    const calls = vi.mocked(f.service.heartbeat).mock.calls.length;
    await vi.advanceTimersByTimeAsync(60000); expect(f.service.heartbeat).toHaveBeenCalledTimes(calls);
  } finally {vi.useRealTimers();}
});

it("rejects an old worker handoff after a new owner recovers the saved base", async () => {
  const f = fixture(); const accepted = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  const old = (await f.service.claim("old"))!;
  await f.service.beginStage(old, "base");
  await f.service.saveStage(old, "base", Buffer.from("base"), {generationMs: 1});
  f.config.now += 11 * 60_000;
  const current = (await f.service.claim("current"))!;
  await expect(f.service.awaitConfirmation(old)).rejects.toMatchObject({code: "stale_worker"});
  await f.service.awaitConfirmation(current);
  expect((await f.service.get(accepted.generationId)).status).toBe("awaiting_confirmation");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).active).toBeNull();
});

it("does not extend base access when the artifact read crosses expiry", async () => {
  const f = fixture(); const accepted = await f.service.generate(f.input(), "203.0.113.5", {reviewBase: true});
  await f.worker("owner");
  const read = f.store.readArtifact.bind(f.store);
  vi.spyOn(f.store, "readArtifact").mockImplementationOnce(async (...args) => {
    const bytes = await read(...args); f.config.now += 86400000; return bytes;
  });
  await expect(f.service.getBase(accepted.generationId)).rejects.toMatchObject({code: "generation_expired"});
});
