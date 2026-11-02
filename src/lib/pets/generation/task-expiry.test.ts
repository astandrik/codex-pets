import {afterEach, expect, it, vi} from "vitest";
import {taskFixture} from "./task-pool.test-utils";
import {GenerationError, moscowDay} from "./model";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {randomUUID} from "node:crypto";

const usage = {textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:0.01};
afterEach(() => vi.unstubAllEnvs());

it.each([false, true])("accounts concurrent expired task results once; cleanup=%s", async cleanup => {
  const f = await taskFixture();
  f.saved(0, ["base"]);
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  state.queue = [f.jobs[0].id];
  f.store.ledger.get("scheduler")!.value = JSON.stringify(state);
  f.clock.now = f.jobs[0].expiresAt - 10;
  const a = (await f.service.claim("first"))!, b = (await f.service.claim("second"))!;
  for (const job of [a, b]) {
    await f.service.beginStage(job, job.workerTask!.stage!);
    await f.service.authorizeStage(job, job.workerTask!.stage!);
  }
  f.clock.now += 20;
  if (cleanup) {
    await f.store.cleanup(f.clock.now);
    expect(await f.service.claim("sweeper")).toBeNull();
  }
  for (const job of [a, b]) {
    await expect(f.service.saveStage(job, job.workerTask!.stage!, Buffer.from(job.worker), {usage,generationMs:1}))
      .rejects.toMatchObject({code:"generation_expired"});
  }
  await f.service.finishExpiredGeneration(a, false);
  let current = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(current.tasks.filter((t: {status:string}) => t.status === "running")).toHaveLength(1);
  expect(current.providerSlots.map((s: {leaseId:string}) => s.leaseId)).toEqual([b.workerLeaseId]);
  await f.service.finishExpiredGeneration(b, false);
  await f.service.finishExpiredGeneration(a, false);
  await expect(f.service.saveStage(a, a.workerTask!.stage!, Buffer.from(a.worker), {usage,generationMs:1}))
    .rejects.toMatchObject({code:"generation_expired"});
  current = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(current.tasks).toHaveLength(0);
  expect(current.providerSlots).toHaveLength(0);
  expect(current.pauseReason).toBeUndefined();
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent[moscowDay(f.clock.now)]).toBe(20_000);
  expect(budget.reservations[f.jobs[0].id]).toBeUndefined();
  for (const job of [a, b]) expect(await f.store.readArtifact(job.id, `stage-${job.workerTask!.stage}.png`, f.clock.now)).toBeNull();
});

it.each(["success", "rejected", "unknown"])("finishes an expired %s provider result without replay or losing a fresh peer", async outcome => {
  const f = await taskFixture(2);
  f.clock.now = f.jobs[0].expiresAt - 10;
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  state.queue = [f.jobs[0].id];
  f.store.ledger.get("scheduler")!.value = JSON.stringify(state);
  const peer = await f.service.generate({requestId:randomUUID(),prompt:"Fresh peer"}, "203.0.113.12");
  let calls = 0;
  const run = createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.clock.now,
    renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>Buffer.from("atlas"),
      generate:async name=>{
        calls++;
        if (job.id === f.jobs[0].id) {
          f.clock.now += 20;
          await f.store.cleanup(f.clock.now);
          if (outcome !== "success") throw new GenerationError(outcome === "rejected" ? "provider_rejected" : "outcome_unknown");
        }
        return {bytes:Buffer.from(name),generationMs:1,usage};
      }})},build:async()=>({})});
  expect(await run("old-owner")).toBe("failed");
  const current = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(current.tasks.some((t:{jobId:string})=>t.jobId===f.jobs[0].id)).toBe(false);
  expect(current.providerSlots).toHaveLength(outcome === "unknown" ? 1 : 0);
  expect(current.pauseReason).toBe(outcome === "unknown" ? "outcome_unknown" : undefined);
  expect(await run("peer-owner")).toBe(outcome === "unknown" ? "idle" : "yielded");
  expect(calls).toBe(outcome === "unknown" ? 1 : 2);
  expect(f.store.jobs.get(peer.generationId)?.status).toBe(outcome === "unknown" ? "queued" : "generating");
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.reservations[f.jobs[0].id]?.unknown).toBe(outcome === "unknown" ? true : undefined);
  expect(budget.spent[moscowDay(f.clock.now)] ?? 0).toBe(outcome === "success" ? 20_000 : outcome === "rejected" ? 10_000 : 0);
});

it("rechecks retention after a slow claim read and starts the fresh peer instead", async () => {
  const f = await taskFixture(2);
  f.clock.now = f.jobs[0].expiresAt - 10;
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  state.queue = [f.jobs[0].id];
  f.store.ledger.get("scheduler")!.value = JSON.stringify(state);
  const peer = await f.service.generate({requestId:randomUUID(),prompt:"Fresh peer"}, "203.0.113.12");
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(run => transaction(tx => run({...tx,
    getJob: async id => {const job = await tx.getJob(id); if (id === f.jobs[0].id) f.clock.now += 20; return job;},
  })));
  expect((await f.service.claim("worker"))?.id).toBe(peer.generationId);
  const saved = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(saved.providerSlots.map((slot:{jobId:string})=>slot.jobId)).toEqual([peer.generationId]);
  expect(f.store.jobs.get(f.jobs[0].id)?.expiresAt).toBe(f.jobs[0].expiresAt);
});

it("keeps the configured 30-parent queue readable after scheduling all animation rows", async () => {
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "30");
  const f = await taskFixture();
  for (let i = f.jobs.length; i < 30; i++) {
    const reply = await f.service.generate({requestId:randomUUID(),prompt:"Queued peer"}, "203.0.113.12");
    f.jobs.push(f.store.jobs.get(reply.generationId)!);
  }
  for (let i = 0; i < f.jobs.length; i++) f.saved(i, ["base"]);
  const first = await f.service.claim("first");
  const next = await f.service.claim("second");
  expect(first?.workerTask?.kind).toBe("image");
  expect(next?.workerTask?.kind).toBe("image");
  expect(next?.id).not.toBe(first?.id);
  const state = JSON.parse(f.store.ledger.get("scheduler")!.value);
  expect(state.tasks).toHaveLength(330);
  expect(state.providerSlots).toHaveLength(2);
});
