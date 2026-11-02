import {afterEach, expect, it, vi} from "vitest";
import {taskFixture} from "./task-pool.test-utils";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {GenerationError, LEASE_MS, STAGE_NAMES, type StageName} from "./model";
import {YdbError} from "@/lib/ydb/client";

afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});

async function fixture(stage: "base" | "idle") {
  const f = await taskFixture(20, true);
  if (stage !== "base") f.saved(0, STAGE_NAMES.filter(name => name !== stage));
  const row = f.store.ledger.get("scheduler")!;
  row.value = JSON.stringify({...JSON.parse(row.value), queue: [f.jobs[0].id]});
  const calls: StageName[] = [];
  const bytes = Buffer.from("synthetic received image");
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    renderer: {open: async () => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("atlas"),
      generate: async name => {calls.push(name); return {bytes, generationMs: 10, usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .04}};}})},
    build: async () => ({"pet.zip": Buffer.from("zip")})});
  return {...f, stage, calls, bytes, run};
}

// Inject at the storage boundary so real receipts, lease checks and budget writes run.
function failCheckpoint(f: Pick<Awaited<ReturnType<typeof fixture>>, "store" | "jobs" | "stage">, mode: "rollback" | "lost-ack", count: number, failure: Error = new Error("synthetic private database error")) {
  const transaction = f.store.transaction.bind(f.store);
  let failures = 0;
  vi.spyOn(f.store, "transaction").mockImplementation(async operation => {
    let target = false;
    const value = await transaction(tx => operation({...tx, putArtifact: async (id, kind, bytes, expiresAt) => {
      if (id === f.jobs[0].id && kind === `stage-${f.stage}.png` && failures < count) {
        target = true;
        failures++;
        if (mode === "rollback") throw failure;
      }
      return tx.putArtifact(id, kind, bytes, expiresAt);
    }}));
    if (target && mode === "lost-ack") throw Error("synthetic lost commit acknowledgement");
    return value;
  });
  return () => failures;
}

it.each(["base", "idle"] as const)("saves the received %s image after a rolled-back checkpoint without another paid call", async stage => {
  const f = await fixture(stage);
  failCheckpoint(f, "rollback", 1);
  expect(await f.run("owner")).toBe("yielded");
  expect(f.calls).toEqual([stage]);
  expect(f.store.jobs.get(f.jobs[0].id)?.stages.find(s => s.name === stage)?.status).toBe("completed");
  expect(await f.store.readArtifact(f.jobs[0].id, `stage-${stage}.png`, f.clock.now)).toEqual(f.bytes);
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent["2026-11-01"]).toBe(40000);
  expect(budget.reservations[f.jobs[0].id].unknown).toBe(false);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({providerSlots: []});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).pauseReason).toBeUndefined();
  expect(f.store.jobs.size).toBe(3);
  if (stage === "idle") expect(f.store.jobs.get(f.jobs[0].id)?.animationRepair?.attempts).toMatchObject([{ordinal: 1, status: "saved"}]);
});

it("logs a bounded checkpoint cause without leaking the database message or generation capability", async () => {
  const f = await fixture("idle");
  class AbortedWrite extends YdbError {static status = 400040;}
  failCheckpoint(f, "rollback", 1, new AbortedWrite("private query, credentials and prompt"));
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  await f.run("owner");
  const entries = log.mock.calls.map(([line]) => JSON.parse(line));
  expect(entries).toEqual([expect.objectContaining({operation: "pet-generation-checkpoint", status: "retry", stage: "idle", databaseStatus: 400040})]);
  expect(JSON.stringify(entries)).not.toMatch(/private query|credentials|prompt/);
  expect(JSON.stringify(entries)).not.toContain(f.jobs[0].id);
});

it.each(["base", "idle"] as const)("replays a committed %s checkpoint without charging twice", async stage => {
  const f = await fixture(stage);
  failCheckpoint(f, "lost-ack", 1);
  expect(await f.run("owner")).toBe("yielded");
  expect(f.calls).toEqual([stage]);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(40000);
  expect(f.store.jobs.get(f.jobs[0].id)?.stages.find(s => s.name === stage)?.status).toBe("completed");
});

it("retains the unknown permit and attempt when checkpoint retries are exhausted", async () => {
  const f = await fixture("idle");
  const failedWrites = failCheckpoint(f, "rollback", Infinity);
  expect(await f.run("owner")).toBe("failed");
  expect(await f.run("finalizer")).toBe("failed");
  expect(await f.run("another-owner")).toBe("idle");
  expect(failedWrites()).toBe(2);
  expect(f.calls).toEqual(["idle"]);
  expect(f.store.jobs.get(f.jobs[0].id)?.animationRepair?.attempts).toMatchObject([{ordinal: 1, status: "started"}]);
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({pauseReason: "outcome_unknown", providerSlots: [{unknown: true}]});
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.jobs[0].id].unknown).toBe(true);
  expect(await f.store.readArtifact(f.jobs[0].id, "stage-idle.png", f.clock.now)).toBeNull();
});

it("preserves sibling results and accounting while one of twenty workers repeats a checkpoint", async () => {
  const f = await taskFixture(20, true);
  failCheckpoint({...f, stage: "idle"}, "rollback", 1);
  const calls: string[] = [];
  const run = createSpriteGenerationWorker({service: f.service, store: f.store, now: () => f.clock.now,
    renderer: {open: async job => ({prepare: async () => {}, cleanup: async () => {}, compose: async () => Buffer.from("atlas"),
      generate: async name => {calls.push(`${job.id}:${name}`); return {bytes: Buffer.from(name), generationMs: 1,
        usage: {textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: .01}};}})},
    build: async () => ({"pet.zip": Buffer.from("zip")})});
  for (let batch = 0; batch < 20 && !f.jobs.every(job => f.store.jobs.get(job.id)?.status === "completed"); batch++) {
    await Promise.all(Array.from({length: 20}, (_, index) => run(`worker-${index}`)));
    f.clock.now += 5000;
  }
  expect(f.jobs.map(job => f.store.jobs.get(job.id)?.status)).toEqual(["completed", "completed", "completed"]);
  expect(calls).toHaveLength(36);
  expect(new Set(calls).size).toBe(36);
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(budget.spent["2026-11-01"]).toBe(360000);
  expect(budget.reservations).toEqual({});
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value)).toMatchObject({providerSlots: [], queue: []});
});

it("does not save the result after losing the lease between checkpoint attempts", async () => {
  const f = await fixture("idle");
  const transaction = f.store.transaction.bind(f.store);
  let rejected = false;
  vi.spyOn(f.store, "transaction").mockImplementation(operation => transaction(tx => operation({...tx,
    putArtifact: async (id, kind, bytes, expiresAt) => {
      if (!rejected && kind === "stage-idle.png") {
        rejected = true;
        f.clock.now += LEASE_MS + 1;
        throw Error("Lost checkpoint reply");
      }
      return tx.putArtifact(id, kind, bytes, expiresAt);
    }})));
  await expect(f.run("expired-owner")).rejects.toMatchObject({code: "stale_worker"});
  await f.run("recovery");
  expect(f.calls).toEqual(["idle"]);
  expect(await f.store.readArtifact(f.jobs[0].id, "stage-idle.png", f.clock.now)).toBeNull();
  expect(f.store.jobs.get(f.jobs[0].id)?.animationRepair?.attempts).toMatchObject([{ordinal: 1, status: "started"}]);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.jobs[0].id].unknown).toBe(true);
});

it("does not retry a rejected checkpoint contract", async () => {
  const f = await fixture("idle");
  const failedWrites = failCheckpoint(f, "rollback", Infinity, new GenerationError("stage_conflict"));
  const log = vi.spyOn(console, "warn").mockImplementation(() => {});
  expect(await f.run("owner")).toBe("failed");
  expect(f.calls).toEqual(["idle"]);
  expect(failedWrites()).toBe(1);
  expect(log).not.toHaveBeenCalled();
  expect(await f.store.readArtifact(f.jobs[0].id, "stage-idle.png", f.clock.now)).toBeNull();
});
