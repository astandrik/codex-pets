import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {taskFixture} from "./task-pool.test-utils";
import {MemoryStore} from "./test-store";

afterEach(() => vi.unstubAllEnvs());
const deferred = () => {let resolve!: () => void; const promise = new Promise<void>(r => {resolve = r;}); return {promise, resolve};};

it("serializes claim transactions and releases the gate after a failure", async () => {
  const f = await taskFixture();
  const gate = deferred();
  const transaction = f.store.transaction.bind(f.store);
  let entered = 0, active = 0, peak = 0;
  vi.spyOn(f.store, "transaction").mockImplementation(async operation => {
    entered++; active++; peak = Math.max(peak, active);
    try {if (entered === 1) {await gate.promise; throw Error("read failed");} return await transaction(operation);}
    finally {active--;}
  });
  const first = f.service.claim("one").catch(error => error.message);
  const others = Array.from({length: 19}, (_, n) => f.service.claim(`worker-${n}`));
  await new Promise(resolve => setImmediate(resolve));
  const beforeRelease = entered;
  gate.resolve();
  expect(await first).toBe("read failed"); await Promise.all(others);
  expect(beforeRelease).toBe(1); expect(peak).toBe(1);
});

it("reconciles v3 with one batch snapshot and re-reads the selected job", async () => {
  const f = await taskFixture();
  const transaction = f.store.transaction.bind(f.store);
  const reads: string[] = [], batches: string[][] = [];
  vi.spyOn(f.store, "transaction").mockImplementation(operation => transaction(tx => operation({...tx,
    getJobs: async ids => {batches.push([...ids]); return tx.getJobs(ids);},
    getJob: async id => {reads.push(id); return tx.getJob(id);},
  })));
  const claimed = await f.service.claim("worker");
  expect(batches).toEqual([f.jobs.map(job => job.id)]);
  expect(reads).toEqual([claimed!.id]);
});

it.each(["", "100"])("uses exactly 100 places including the active legacy parent, configured=%s", async limit => {
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", limit);
  const store = new MemoryStore();
  const service = createGenerationService(store, {enabled: () => true, secret: () => "synthetic", now: () => Date.UTC(2026, 10, 7)});
  const first = {requestId: randomUUID(), prompt: "Synthetic"};
  const accepted = await service.generate(first, "203.0.113.1");
  await service.claim("active");
  const results = await Promise.allSettled(Array.from({length: 100}, (_, i) => service.generate({requestId: randomUUID(), prompt: "Synthetic"}, `198.51.100.${i + 1}`)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(99);
  expect(store.jobs.size).toBe(100);
  const before = structuredClone([...store.ledger]);
  expect((await service.generate(first, "203.0.113.1")).generationId).toBe(accepted.generationId);
  expect([...store.ledger]).toEqual(before);
});

it.each(["stopping", "disabled"])("checks %s again after waiting for another claim", async reason => {
  const store = new MemoryStore(); let enabled = true, stopping = false;
  const service = createGenerationService(store, {enabled: () => enabled, secret: () => "synthetic"});
  const gate = deferred(), entered = deferred();
  const transaction = store.transaction.bind(store);
  const spy = vi.spyOn(store, "transaction").mockImplementationOnce(async operation => {entered.resolve(); await gate.promise; return transaction(operation);});
  const first = service.claim("first"); await entered.promise;
  const second = service.claim("second", () => stopping);
  if (reason === "disabled") enabled = false; else stopping = true;
  gate.resolve(); await first;
  expect(await second).toBeNull(); expect(spy).toHaveBeenCalledTimes(1);
});

it("keeps independent services safe with three unknown slots and live heartbeat while another claim waits", async () => {
  const f = await taskFixture(); f.saved(0, ["base"]); f.saved(1, ["base"]); f.saved(2, ["base"]);
  const raw = JSON.parse(f.store.ledger.get("scheduler")!.value);
  raw.providerSlots = Array.from({length: 3}, (_, i) => ({jobId: String(i + 6).repeat(64),owner:"old",leaseId:randomUUID(),key:"stage:base",startedAt:f.clock.now-1000,unknown:true,dispatched:true}));
  f.store.ledger.get("scheduler")!.value = JSON.stringify(raw);
  const oldSlots = structuredClone(raw.providerSlots);
  const second = createGenerationService(f.store, {enabled: () => true, secret: () => "synthetic", now: () => f.clock.now});
  const claimed = await Promise.all(Array.from({length: 30}, (_, i) => (i % 2 ? f.service : second).claim(`process-${i}`)));
  expect(claimed.filter(Boolean)).toHaveLength(17);
  expect(new Set(claimed.filter(Boolean).map(j => j!.workerLeaseId)).size).toBe(17);
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.providerSlots).toHaveLength(20); expect(state.providerSlots.slice(0, 3)).toEqual(oldSlots);
  const gate = deferred(), entered = deferred(), transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(async operation => {entered.resolve();await gate.promise;return transaction(operation);});
  const pending = f.service.claim("waiting"); await entered.promise;
  await expect(f.service.heartbeat(claimed.find(Boolean)!)).resolves.toMatchObject({id: claimed.find(Boolean)!.id});
  gate.resolve(); await pending;
});

it("does not reuse a committed lease after its acknowledgement is lost", async () => {
  const f = await taskFixture();
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(async operation => {await transaction(operation);throw Error("lost commit acknowledgement");});
  await expect(f.service.claim("lost-owner")).rejects.toThrow("lost commit");
  const before = JSON.parse(f.store.ledger.get("scheduler")!.value);
  const firstSlot = before.providerSlots[0];
  expect(firstSlot.dispatched).toBe(false);
  const next = await f.service.claim("next-owner");
  expect(next!.workerLeaseId).not.toBe(firstSlot.leaseId);
  const after = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(after.providerSlots).toContainEqual(firstSlot);
  expect(after.providerSlots).toHaveLength(2);
  expect(f.store.jobs.get(firstSlot.jobId)?.stages).toEqual([]);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent).toEqual({});
});

it("rebuilds the reconciliation snapshot on transaction replay", async () => {
  const f = await taskFixture(); const transaction = f.store.transaction.bind(f.store);
  let batches = 0;
  vi.spyOn(f.store, "transaction").mockImplementationOnce(async operation => {
    const run = (fail: boolean) => transaction(async tx => {
      const result = await operation({...tx, getJobs: async ids => {batches++;return tx.getJobs(ids);}});
      if (fail) throw Error("synthetic ABORTED"); return result;
    });
    try {await run(true);} catch { /* Only the test's injected known rollback is replayed. */ }
    f.saved(0, ["base"]);
    return run(false);
  });
  const job = await f.service.claim("replayed");
  expect(batches).toBe(2);expect(job?.workerTask?.stage).not.toBe("base");
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toHaveLength(1);
});

it("shares the hundredth place between confirmation and a new UUID without charging the loser", async () => {
  const f = await taskFixture();
  // Reuse a saved base as an unconfirmed parent outside the active queue.
  f.saved(0, ["base"]);
  const source = f.store.jobs.get(f.jobs[0].id)!;source.reviewBase = true;source.status = "awaiting_confirmation";
  const raw = JSON.parse(f.store.ledger.get("scheduler")!.value);raw.queue = [];
  f.store.ledger.get("scheduler")!.value = JSON.stringify(raw);
  for (let i = 0; i < 99; i++) await f.service.generate({requestId:randomUUID(),prompt:"Synthetic"},`198.51.100.${i+1}`);
  const newInput = {requestId:randomUUID(),prompt:"Synthetic"};
  const results = await Promise.allSettled([f.service.confirm(source.id),f.service.generate(newInput,"203.0.113.99")]);
  expect(results[0].status).toBe("fulfilled");expect(results[1]).toMatchObject({status:"rejected",reason:{code:"queue_full"}});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).queue).toHaveLength(100);
  const before = structuredClone([...f.store.ledger]);
  expect((await f.service.confirm(source.id)).newlyQueued).toBe(false);
  expect([...f.store.ledger]).toEqual(before);
  expect(f.store.jobs.get(source.id)?.expiresAt).toBe(source.expiresAt);
});

it.each(["begin", "authorize", "complete", "fail", "refresh"])("rejects expired lease after waiting for a database turn: %s", async action => {
  const f = await taskFixture();
  const job = (await f.service.claim("owner"))!;
  if (action === "authorize") await f.service.beginStage(job, "base");
  const gate = deferred(), entered = deferred();
  const blocking = f.store.transaction(async () => {entered.resolve();await gate.promise;});
  await entered.promise;
  const pending = action === "begin" ? f.service.beginStage(job, "base") : action === "authorize" ? f.service.authorizeStage(job, "base")
    : action === "complete" ? f.service.completeTask(job) : action === "refresh" ? f.service.readWorkerJob(job) : f.service.fail(job, "provider_rejected");
  const rejection = expect(pending).rejects.toMatchObject({code:"stale_worker"});
  f.clock.now = job.leaseUntil! + 1;
  gate.resolve();await blocking;await rejection;
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent).toEqual({});
});

it("keeps seventeen provider calls concurrent beside three unknown permits", async () => {
  const {createSpriteGenerationWorker} = await import("./sprite-worker");
  const f = await taskFixture();
  for (let i = 0; i < 3; i++) f.saved(i, ["base"]);
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  const unknown = Array.from({length:3}, (_, i) => ({jobId:String(i+6).repeat(64),owner:"old",leaseId:randomUUID(),key:"stage:base",startedAt:f.clock.now-1000,unknown:true,dispatched:true}));
  state.providerSlots = unknown;f.store.ledger.get("scheduler")!.value = JSON.stringify(state);
  const release = deferred(), allStarted = deferred();
  let active = 0, peak = 0, calls = 0;
  const worker = createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:{open:async()=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("unused"),generate:async()=>{
      calls++;active++;peak=Math.max(peak,active);if(active===17)allStarted.resolve();
      await release.promise;active--;return{bytes:Buffer.from("synthetic row"),generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:0.01}};
    }})}});
  const runs=Promise.all(Array.from({length:20},(_,i)=>worker(`worker-${i}`)));
  void runs.catch(() => undefined);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([allStarted.promise,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error("provider concurrency stalled")),2000);})]);
    expect(calls).toBe(17);expect(peak).toBe(17);
  } finally {clearTimeout(timeout);release.resolve();await runs;}
  expect(calls).toBe(17);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toEqual(unknown);
  expect(Object.values(JSON.parse(f.store.ledger.get("budget")!.value).spent)).toEqual([170000]);
});
