import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";
import {DAY, type GenerationJob} from "./model";
import {expireQueue, saveScheduler, scheduler} from "./scheduler";

afterEach(() => vi.unstubAllEnvs());
const now = Date.parse("2026-10-31T12:00:00Z");

it.each([5, 30, 200])("uses the batched reader for a full %s-job queue and keeps the claim-time read", async capacity => {
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", String(capacity));
  const store = new MemoryStore();
  const service = createGenerationService(store, {enabled: () => true, secret: () => "synthetic-batch-secret", now: () => now});
  for (let i = 0; i < capacity; i++) await service.generate({requestId: randomUUID(), prompt: "Synthetic"}, `203.0.113.${i + 1}`);
  const transaction = store.transaction.bind(store);
  let batches = 0, pointReads = 0;
  vi.spyOn(store, "transaction").mockImplementation(operation => transaction(tx => operation({...tx,
    getJobs: async ids => {batches++; return tx.getJobs(ids);},
    getJob: async id => {pointReads++; return tx.getJob(id);},
  })));
  await expect(service.generate({requestId: randomUUID(), prompt: "Synthetic"}, "198.51.100.1")).rejects.toMatchObject({code: "queue_full"});
  expect({batches, pointReads}).toEqual({batches: 1, pointReads: 0});
  batches = 0; pointReads = 0;
  expect(await service.claim("synthetic-worker")).not.toBeNull();
  expect({batches, pointReads}).toEqual({batches: 1, pointReads: 1});
});

function mixedQueue() {
  const store = new MemoryStore();
  const ids = Array.from({length: 6}, (_, i) => (i + 1).toString(16).padStart(64, "0"));
  const [live, aged, ttl, done, missing, tail] = ids;
  const job = (id: string): GenerationJob => ({id, prompt: "Synthetic", displayName: "Synthetic", status: "queued", createdAt: now - 1000, expiresAt: now + DAY, worker: "", promptRevision: "test", pipelineVersion: 2, stages: []});
  store.jobs.set(live, job(live));
  store.jobs.set(tail, job(tail));
  store.jobs.set(aged, {...job(aged), queuedAt: now - 2 * 60 * 60_000});
  store.jobs.set(ttl, {...job(ttl), expiresAt: now - 1});
  store.jobs.set(done, {...job(done), status: "completed"});
  store.ledger.set("scheduler", {value: JSON.stringify({revision: 0, queue: [live, aged, missing, done, ttl, tail, live], active: null}), expiresAt: now + DAY});
  store.ledger.set("budget", {value: JSON.stringify({spent: {"2026-10-31": 12345}, reservations: {
    [aged]: {remainingMicroUsd: 0, unknown: true}, [ttl]: {remainingMicroUsd: 0, unknown: false}, [missing]: {remainingMicroUsd: 0, unknown: false},
  }}), expiresAt: now + 7 * DAY});
  store.ledger.set("day:2026-10-31", {value: "7", expiresAt: now + DAY});
  return {store, live, aged, ttl, done, tail};
}

it("preserves aged queue entries, FIFO and unknown charges when a batch omits missing jobs", async () => {
  const {store, live, aged, ttl, done, tail} = mixedQueue();
  await store.transaction(async tx => {
    const state = await scheduler(tx, now);
    await expireQueue({...tx, getJobs: async ids => new Map([...(await tx.getJobs(ids))].reverse())}, state, now);
    await saveScheduler(tx, state);
  });
  expect(JSON.parse(store.ledger.get("scheduler")!.value).queue).toEqual([live, aged, tail, live]);
  expect(store.jobs.get(aged)).toMatchObject({status: "queued", prompt: "Synthetic"});
  expect(store.jobs.get(ttl)?.expiresAt).toBe(now - 1);
  expect(store.jobs.get(done)?.status).toBe("completed");
  expect(store.ledger.get("day:2026-10-31")?.value).toBe("7");
  expect(JSON.parse(store.ledger.get("budget")!.value)).toEqual({spent: {"2026-10-31": 12345}, reservations: {[aged]: {remainingMicroUsd: 0, unknown: true}}});
});

it("rolls back batch-based storage-expiry cleanup and budget settlement if the transaction aborts", async () => {
  const {store} = mixedQueue();
  const before = structuredClone({jobs: [...store.jobs], ledger: [...store.ledger]});
  await expect(store.transaction(async tx => {
    const state = await scheduler(tx, now); await expireQueue(tx, state, now); await saveScheduler(tx, state);
    throw Error("synthetic abort");
  })).rejects.toThrow("synthetic abort");
  expect({jobs: [...store.jobs], ledger: [...store.ledger]}).toEqual(before);
});

it("settles a duplicated expired known reservation only once", async () => {
  const {store, ttl} = mixedQueue();
  const budgetWrites = vi.fn();
  await store.transaction(async tx => {
    await expireQueue({...tx, putLedger: async (...args) => {if (args[0] === "budget") budgetWrites(); await tx.putLedger(...args);}}, {revision: 0, queue: [ttl, ttl], active: null}, now);
  });
  expect(budgetWrites).toHaveBeenCalledOnce();
});

it("reads transaction-local job changes and skips the database for an empty queue", async () => {
  const {store, live} = mixedQueue();
  await store.transaction(async tx => {
    await tx.putJob({...store.jobs.get(live)!, displayName: "Updated in transaction"});
    expect((await tx.getJobs([live, live])).get(live)?.displayName).toBe("Updated in transaction");
    const getJobs = vi.fn(tx.getJobs);
    await expireQueue({...tx, getJobs}, {revision: 0, queue: [], active: null}, now);
    expect(getJobs).not.toHaveBeenCalled();
  });
});

it("replays an accepted UUID without any queue batch or new accounting writes", async () => {
  const store = new MemoryStore();
  const service = createGenerationService(store, {enabled: () => true, secret: () => "synthetic-replay", now: () => now});
  const input = {requestId: randomUUID(), prompt: "Synthetic"};
  const accepted = await service.generate(input, "203.0.113.1");
  const before = structuredClone([...store.ledger]);
  const transaction = store.transaction.bind(store), batch = vi.fn();
  vi.spyOn(store, "transaction").mockImplementation(operation => transaction(tx => operation({...tx,
    getJobs: async ids => {batch(); return tx.getJobs(ids);},
  })));
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "invalid");
  expect((await service.generate(input, "203.0.113.1")).generationId).toBe(accepted.generationId);
  expect(batch).not.toHaveBeenCalled();
  expect([...store.ledger]).toEqual(before);
});
