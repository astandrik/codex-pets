import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {MemoryStore} from "./test-store";
import {DAY, LEASE_MS} from "./model";

const HOUR = 60 * 60_000;
function fixture() {
  const store = new MemoryStore(), clock = {now: Date.parse("2026-11-01T10:00:00Z")};
  const service = createGenerationService(store, {now: () => clock.now, enabled: () => true, secret: () => "queue-retention-test-secret"});
  const generate = vi.fn(async (name: string) => ({bytes: Buffer.from(name), generationMs: 1, usage: {textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:0.01}}));
  const worker = createSpriteGenerationWorker({store, service, now: () => clock.now,
    renderer: {open: async () => ({generate, prepare: async () => {}, compose: async () => Buffer.from("atlas"), cleanup: async () => {}})},
    build: async () => ({"pet.zip": Buffer.from("zip")})});
  const input = () => ({requestId: randomUUID(), prompt: "A patient synthetic fox"});
  const state = () => JSON.parse(store.ledger.get("scheduler")!.value);
  return {store, clock, service, generate, worker, input, state};
}
afterEach(() => vi.restoreAllMocks());

it("keeps public status and UUID replay queued after the former waiting deadline", async () => {
  const f = fixture(), input = f.input(), accepted = await f.service.generate(input, "203.0.113.1");
  f.clock.now += 2 * HOUR;
  const before = structuredClone([...f.store.ledger]);
  expect(await f.service.get(accepted.generationId)).toMatchObject({status:"queued", expiresAt:accepted.expiresAt, pollAfterSeconds:5});
  expect((await f.service.generate(input, "203.0.113.1")).status).toBe("queued");
  expect([...f.store.ledger]).toEqual(before);
  expect(f.store.jobs.get(accepted.generationId)?.prompt).toBe(input.prompt);
});

it("does not discard old queued tasks when a new request cleans the queue", async () => {
  const f = fixture(), first = await f.service.generate(f.input(), "203.0.113.1");
  f.clock.now += 2 * HOUR;
  const second = await f.service.generate(f.input(), "203.0.113.2");
  expect(f.state().queue).toEqual([first.generationId, second.generationId]);
  expect(f.store.jobs.get(first.generationId)?.status).toBe("queued");
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[first.generationId]).toBeDefined();
});

it("can complete a task that waited almost its full 24-hour lifetime", async () => {
  const f = fixture(), accepted = await f.service.generate(f.input(), "203.0.113.1");
  f.clock.now = Date.parse(accepted.expiresAt) - 1;
  expect(await f.worker("late-worker")).toBe("completed");
  expect(f.generate).toHaveBeenCalledTimes(12);
  expect((await f.service.get(accepted.generationId)).expiresAt).toBe(accepted.expiresAt);
});

it.each([false, true])("retains an old queued task while claiming is blocked, paused=%s", async paused => {
  const f = fixture(); await f.service.generate(f.input(), "203.0.113.1");
  const active = (await f.service.claim("active"))!;
  const waiting = await f.service.generate(f.input(), "203.0.113.2");
  f.clock.now += 2 * HOUR;
  const state = f.state(); state.active.until = f.clock.now + LEASE_MS;
  if (paused) state.pauseReason = "outcome_unknown";
  f.store.ledger.get("scheduler")!.value = JSON.stringify(state);
  expect(await f.service.claim("other")).toBeNull();
  expect(f.state()).toMatchObject({queue:[waiting.generationId], active:{id:active.id}});
  expect((await f.service.get(waiting.generationId)).status).toBe("queued");
});

it("still expires storage at 24 hours without calling the provider or extending retention", async () => {
  const f = fixture(), accepted = await f.service.generate(f.input(), "203.0.113.1");
  const counts = structuredClone([...f.store.ledger].filter(([key]) => key.startsWith("day:") || key.startsWith("ip:")));
  f.clock.now += DAY;
  await expect(f.service.get(accepted.generationId)).rejects.toMatchObject({code:"generation_expired"});
  expect(f.store.jobs.get(accepted.generationId)?.expiresAt).toBe(Date.parse(accepted.expiresAt));
  expect(await f.worker("expired")).toBe("idle");
  expect(f.generate).not.toHaveBeenCalled();
  expect(f.state().queue).toEqual([]);
  expect(f.store.jobs.has(accepted.generationId)).toBe(false);
  expect([...f.store.ledger].filter(([key]) => key.startsWith("day:") || key.startsWith("ip:"))).toEqual(counts);
});

it("keeps historical queue-timeout failures terminal", async () => {
  const f = fixture(), request = f.input(), accepted = await f.service.generate(request, "203.0.113.1");
  Object.assign(f.store.jobs.get(accepted.generationId)!, {status:"failed", error:"queue_timeout", prompt:""});
  expect((await f.service.generate(request,"203.0.113.1")).status).toBe("failed");
  expect((await f.service.get(accepted.generationId)).error?.code).toBe("queue_timeout");
  expect(await f.worker("history")).toBe("idle");
  expect(f.generate).not.toHaveBeenCalled();
});
