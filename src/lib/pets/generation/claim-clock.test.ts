import {randomUUID} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {MemoryStore} from "./test-store";
import {LEASE_MS,WAIT_MS} from "./model";

function fixture() {
  const store = new MemoryStore(), clock = {now: Date.parse("2026-10-18T09:00:00Z")};
  const service = createGenerationService(store, {now: () => clock.now, enabled: () => true, secret: () => "claim-clock-test-secret-at-least-32-characters"});
  const generate = vi.fn(async () => ({bytes: Buffer.from("synthetic-stage"), generationMs: 1, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .001}}));
  const worker = createSpriteGenerationWorker({service, store, now: () => clock.now, renderer: {open: async () => ({prepare: async () => undefined, generate, compose: async () => Buffer.from("atlas"), cleanup: async () => undefined})}, build: async () => ({"pet.zip": Buffer.from("zip")})});
  const admit = (reviewBase = false) => service.generate({prompt: "Synthetic fox", requestId: randomUUID()}, "203.0.113.5", {reviewBase});
  const state = () => JSON.parse(store.ledger.get("scheduler")!.value);
  const quota = () => [...store.ledger].filter(([key]) => key.startsWith("ip:") || key.startsWith("day:"));
  return {store, clock, service, generate, worker, admit, state, quota};
}
afterEach(() => vi.restoreAllMocks());

it.each(["transaction", "scheduler", "candidate"])("does not call the provider when queue deadline passes during %s", async boundary => {
  const f = fixture(), first = await f.admit();
  const deadline = f.clock.now + WAIT_MS; f.clock.now = deadline - 1;
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => {
    if (boundary === "transaction") f.clock.now = deadline + 1000;
    return operation({...tx,
      getLedger: async (...args) => {const value = await tx.getLedger(...args); if (boundary === "scheduler" && args[0] === "scheduler") f.clock.now = deadline + 1000; return value;},
      getJob: async id => {const value = await tx.getJob(id); if (boundary === "candidate") f.clock.now = deadline + 1000; return value;},
    });
  }));
  const quota = structuredClone(f.quota());
  expect(await f.worker("expired")).toBe("idle");
  expect(f.generate).not.toHaveBeenCalled(); expect(await f.store.readJob(first.generationId)).toMatchObject({status: "failed", error: "queue_timeout", prompt: ""});
  expect(f.state()).toMatchObject({active: null, queue: []}); expect(f.quota()).toEqual(quota);
});

it("skips a continuation expiring during reads and frees the next job without extending TTL", async () => {
  const f = fixture(), first = await f.admit(true); await f.worker("base");
  const expires = Date.parse(first.expiresAt); f.clock.now = expires - 1000; await f.service.confirm(first.generationId);
  const next = await f.admit(); f.clock.now = expires - 1;
  const quota = structuredClone(f.quota()), transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const value = await tx.getJob(id); if (id === first.generationId) f.clock.now = expires + 1000; return value;},
  })));
  const claimed = await f.service.claim("next");
  expect(claimed?.id).toBe(next.generationId); expect(f.state().active.id).toBe(next.generationId);
  expect((await f.store.readJob(first.generationId))?.expiresAt).toBe(expires);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[first.generationId]).toBeUndefined(); expect(f.quota()).toEqual(quota);
  expect(f.generate).toHaveBeenCalledTimes(1); // Only the previously approved base phase ran.
});

it("skips multiple timed-out candidates in FIFO order and preserves costs and unknown tracking", async () => {
  const f = fixture(), first = await f.admit(), second = await f.admit();
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  budget.spent = {"2026-10-18": 12345}; budget.reservations[first.generationId].unknown = true;
  f.store.ledger.get("budget")!.value = JSON.stringify(budget);
  f.clock.now += WAIT_MS - 1000; const next = await f.admit(), last = await f.admit();
  const quota = structuredClone(f.quota()), transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const value = await tx.getJob(id); if (id === first.generationId) f.clock.now += 2000; return value;},
  })));
  expect((await f.service.claim("owner"))?.id).toBe(next.generationId);
  expect(f.state().queue).toEqual([last.generationId]);
  for (const id of [first.generationId, second.generationId]) expect(await f.store.readJob(id)).toMatchObject({status: "failed", error: "queue_timeout"});
  const saved = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(saved.spent).toEqual(budget.spent); expect(saved.reservations[first.generationId]).toMatchObject({unknown: true}); expect(saved.reservations[second.generationId]).toBeUndefined(); expect(f.quota()).toEqual(quota);
});

it("computes a new lease from the decision clock after a successful delayed read", async () => {
  const f = fixture(), accepted = await f.admit(), start = f.clock.now;
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const value = await tx.getJob(id); f.clock.now += 100; return value;},
  })));
  const claimed = await f.service.claim("owner");
  expect(f.clock.now).toBeGreaterThan(start); expect(claimed?.id).toBe(accepted.generationId);
  expect(claimed?.leaseUntil).toBe(f.clock.now + LEASE_MS); expect(f.state().active.until).toBe(claimed?.leaseUntil);
});

it("rechecks the clock on a retried transaction and keeps single ownership across workers", async () => {
  const f = fixture(), first = await f.admit(), start = f.clock.now;
  f.clock.now += WAIT_MS - 1000; const next = await f.admit();
  const transaction = f.store.transaction.bind(f.store), abort = Error("synthetic transaction retry");
  vi.spyOn(f.store, "transaction").mockImplementationOnce(async operation => {
    try {await transaction(async tx => {await operation(tx); throw abort;});} catch (error) {if (error !== abort) throw error;}
    f.clock.now = start + WAIT_MS + 1;
    return transaction(operation);
  });
  const claimed = await f.service.claim("retry-owner"); expect(claimed?.id).toBe(next.generationId);
  expect(await f.store.readJob(first.generationId)).toMatchObject({status: "failed", error: "queue_timeout"});
  const other = await Promise.all([f.service.claim("second"), f.service.claim("third")]); expect(other).toEqual([null, null]);
  expect(f.state().active.owner).toBe("retry-owner");
});

it.each(["saved-base", "processing", "card-inflight"])("does not recover expired %s checkpoints after a delayed read", async kind => {
  const f = fixture(), first = await f.admit(true), job = (await f.service.claim("old"))!;
  await f.service.beginStage(job, "base"); await f.service.saveStage(job, "base", Buffer.from("base"), {generationMs: 1});
  const expires = job.expiresAt;
  const current = f.store.jobs.get(job.id)!;
  if (kind !== "saved-base") {
    current.status = "processing";
    if (kind === "card-inflight") current.cardMetadata = {policy: 1, state: "inflight", revision: 0, edited: false};
  }
  const state = f.state(); state.active.until = expires - 10; state.active.inflight = kind === "card-inflight";
  f.store.ledger.get("scheduler")!.value = JSON.stringify(state); f.clock.now = expires - 1;
  const next = await f.admit(), transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const value = await tx.getJob(id); if (id === first.generationId) f.clock.now = expires + 1000; return value;},
  })));
  const claimed = await f.service.claim("recovery");
  if (kind === "card-inflight") {expect(claimed).toBeNull(); expect(f.state()).toMatchObject({active: null, pauseReason: "outcome_unknown"});}
  else expect(claimed?.id).toBe(next.generationId);
  expect((await f.store.readJob(first.generationId))?.worker).toBe("old");
});

it("uses fresh lease time for recovery without repeating the saved base", async () => {
  const f = fixture(); await f.admit(true); const job = (await f.service.claim("old"))!;
  await f.service.beginStage(job, "base"); await f.service.saveStage(job, "base", Buffer.from("base"), {generationMs: 1});
  f.clock.now += LEASE_MS + 1; const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const value = await tx.getJob(id); f.clock.now += 100; return value;},
  })));
  const recovered = (await f.service.claim("new"))!;
  expect(recovered.leaseUntil).toBe(f.clock.now + LEASE_MS); expect(recovered.stages).toHaveLength(1);
  await expect(f.service.heartbeat(job)).rejects.toMatchObject({code: "stale_worker"});
  await f.service.awaitConfirmation(recovered); expect(f.generate).not.toHaveBeenCalled();
});

it("uses continuation queuedAt instead of the original admission clock", async () => {
  const f = fixture(), first = await f.admit(true); await f.worker("base");
  f.clock.now += 2 * WAIT_MS; await f.service.confirm(first.generationId); f.clock.now += WAIT_MS - 1;
  const claimed = (await f.service.claim("rows"))!; expect(claimed.id).toBe(first.generationId);
  expect(claimed.queuedAt).toBe(f.clock.now - WAIT_MS + 1); expect(claimed.expiresAt).toBe(Date.parse(first.expiresAt));
});

it.each([false, true])("persists queue cleanup while an active slot or pause prevents claiming, paused=%s", async paused => {
  const f = fixture(); await f.admit(); const active = (await f.service.claim("active"))!; const waiting = await f.admit();
  f.clock.now += WAIT_MS + 1;
  const state = f.state(); state.active.until = f.clock.now + LEASE_MS;
  if (paused) state.pauseReason = "outcome_unknown";
  f.store.ledger.get("scheduler")!.value = JSON.stringify(state);
  expect(await f.service.claim("blocked")).toBeNull();
  expect(f.state().queue).toEqual([]); expect(f.state().active.id).toBe(active.id);
  expect((await f.store.readJob(waiting.generationId))?.error).toBe("queue_timeout");
});

it("settles the last expired candidate and persists an empty scheduler", async () => {
  const f = fixture(), accepted = await f.admit(); const quota = structuredClone(f.quota());
  f.clock.now += WAIT_MS - 1;
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const value = await tx.getJob(id); f.clock.now += 10; return value;},
  })));
  expect(await f.service.claim("expired")).toBeNull();
  expect(f.state()).toMatchObject({queue: [], active: null}); expect(f.quota()).toEqual(quota);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[accepted.generationId]).toBeUndefined();
});
