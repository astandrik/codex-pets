import {afterEach, expect, it, vi} from "vitest";
import {StatusCode, YdbError} from "@/lib/ydb/client";
import {GenerationError, LEASE_MS, STAGE_NAMES, type GenerationJob, type StageName} from "@/lib/pets/generation/model";
import {taskFixture} from "@/lib/pets/generation/task-pool.test-utils";
import {createSpriteGenerationWorker} from "@/lib/pets/generation/sprite-worker";
import {createWorkerContext, withWorkerContext} from "@/lib/pets/generation/worker-diagnostics";
import {runWorkerPool} from "@/lib/pets/generation/worker-runner";

type Kind = "animation" | "base" | "row";
class Aborted extends YdbError {static status = StatusCode.ABORTED;}
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});

async function fixture(kind: Kind, failures = 1, neighbor = false, readError: Error = new Aborted("retry snapshot aborted")) {
  const f = await taskFixture(20, kind !== "row"), id = f.jobs[0].id;
  if (kind !== "base") f.saved(0, STAGE_NAMES.filter(stage => stage !== "idle"));
  else f.store.jobs.set(id, {...f.jobs[0], reviewBase: true, baseRetrySourceId: "b".repeat(64),
    baseRepair: {policy: 1, maxAttempts: 4, phase: "active", attempts: []}});
  const state = () => JSON.parse(f.store.ledger.get("scheduler")!.value);
  const saveState = (value: ReturnType<typeof state>) => {f.store.ledger.get("scheduler")!.value = JSON.stringify(value);};
  saveState({...state(), queue: neighbor ? [id, f.jobs[1].id] : [id]});
  let armed = false, injected = 0, beforeFailure: GenerationJob | undefined;
  let ledgerBeforeFailure: Map<string, {value: string; expiresAt: number}> | undefined;
  let onReadFailure = () => {};
  let cleanupError: Error | undefined;
  const capture = () => {
    armed = true;
    beforeFailure = structuredClone(f.store.jobs.get(id)!);
    ledgerBeforeFailure = structuredClone(new Map([...f.store.ledger].filter(([key]) => key !== "scheduler")));
  };
  if (kind === "animation") {
    const record = f.service.failAnimationAttempt.bind(f.service);
    vi.spyOn(f.service, "failAnimationAttempt").mockImplementation(async (...args) => {const result = await record(...args); capture(); return result;});
  } else if (kind === "base") {
    const record = f.service.failBaseAttempt.bind(f.service);
    vi.spyOn(f.service, "failBaseAttempt").mockImplementation(async (...args) => {const result = await record(...args); capture(); return result;});
  } else {
    const record = f.service.recordRowAttemptFailure.bind(f.service);
    vi.spyOn(f.service, "recordRowAttemptFailure").mockImplementation(async (...args) => {const result = await record(...args); capture(); return result;});
  }
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementation(operation => transaction(async tx => {
    let read = false, wrote = false;
    const result = await operation({...tx,
      getJob: async (...args) => {if (args[0] === id) read = true; return tx.getJob(...args);},
      putJob: async (...args) => {wrote = true; return tx.putJob(...args);},
      putLedger: async (...args) => {wrote = true; return tx.putLedger(...args);},
    });
    // Fault only a read transaction: claim, failure checkpoints and fenced yield remain real.
    if (armed && injected < failures && read && !wrote) {injected++; onReadFailure(); throw readError;}
    return result;
  }));
  const calls: {id: string; stage: StageName; attempt?: number}[] = [];
  let rejected = false;
  const run = createSpriteGenerationWorker({store: f.store, service: f.service, now: () => f.clock.now,
    renderer: {open: async job => ({prepare: async () => {}, cleanup: async () => {if (cleanupError) throw cleanupError;}, compose: async () => Buffer.from("atlas"),
      generate: async (stage, context) => {
        calls.push({id: job.id, stage, attempt: context?.attempt});
        if (job.id === id && !rejected) {
          rejected = true;
          throw new GenerationError("outcome_unknown", undefined, undefined, undefined,
            {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});
        }
        return {bytes: Buffer.from(`image ${job.id} ${stage}`), generationMs: 1,
          usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: .01}};
      }})}});
  const events: {error: unknown; phase: string; secondary: boolean}[] = [];
  async function step() {
    const context = createWorkerContext("owner", (error, context, secondary) => events.push({error, phase: context.phase, secondary}));
    return withWorkerContext(context, () => run("owner", context));
  }
  const current = () => f.store.jobs.get(id)!;
  return {...f, id, state, saveState, calls, events, step, current, readError, run, injected: () => injected,
    beforeFailure: () => beforeFailure!, ledgerBeforeFailure: () => ledgerBeforeFailure!,
    failCleanup: (error: Error) => {cleanupError = error;},
    onReadFailure: (callback: () => void) => {onReadFailure = callback;}};
}

it.each(["row", "animation", "base"] as const)("defers an aborted %s pre-retry read without new UUID or spending", async kind => {
  const f = await fixture(kind);
  expect(await f.step()).toBe("yielded");
  expect(f.injected()).toBe(1);
  expect(f.current()).toEqual(f.beforeFailure());
  expect(new Map([...f.store.ledger].filter(([key]) => key !== "scheduler"))).toEqual(f.ledgerBeforeFailure());
  expect(f.current().rowRetries ?? []).toHaveLength(0);
  expect(f.calls).toHaveLength(1);
  expect(f.events).toContainEqual({error: f.readError, phase: "intent", secondary: false});
  expect(f.state().pauseReason).toBeUndefined();
  expect(f.state().providerSlots).toHaveLength(0);
  f.clock.now += 5001;
  expect(await f.step()).toBe("yielded");
  expect(f.calls).toHaveLength(1);
  const attempts = kind === "base" ? f.current().baseRepair!.attempts
    : kind === "animation" ? f.current().animationRepair!.attempts.filter(attempt => attempt.state === "idle") : f.current().rowRetries!;
  const nextToken = attempts.at(-1)!.token;
  if (kind !== "row") expect(attempts).toHaveLength(2);
  f.clock.now += 5001;
  expect(await f.step()).toBe("yielded");
  expect(f.calls.filter(call => call.id === f.id)).toEqual([
    {id: f.id, stage: kind === "base" ? "base" : "idle", attempt: kind === "row" ? undefined : 1},
    {id: f.id, stage: kind === "base" ? "base" : "idle", attempt: kind === "row" ? undefined : 2},
  ]);
  if (kind === "row") expect(f.current().rowRetries).toMatchObject([{token: nextToken, state: "completed"}]);
  else if (kind === "base") expect(f.current().baseRepair!.attempts[1]).toMatchObject({token: nextToken, ordinal: 2, status: "saved"});
  else expect(f.current().animationRepair!.attempts.find(attempt => attempt.token === nextToken)).toMatchObject({ordinal: 2, status: "saved"});
  expect(JSON.parse(f.store.ledger.get("budget")!.value).spent["2026-11-01"]).toBe(10000);
  expect(f.state().pauseReason).toBeUndefined();
});

it("lets another character progress while repeated snapshot reads are deferred", async () => {
  const f = await fixture("row", 2, true);
  expect(await f.step()).toBe("yielded");
  expect(await f.step()).toBe("yielded");
  expect(f.calls.map(call => call.id)).toEqual([f.id, f.jobs[1].id]);
  expect(f.store.jobs.get(f.jobs[1].id)!.stages).toContainEqual(expect.objectContaining({name: "base", status: "completed"}));
  f.clock.now += 5001;
  expect(await f.step()).toBe("yielded");
  expect(f.injected()).toBe(2);
  expect(f.current()).toEqual(f.beforeFailure());
  expect(f.calls.filter(call => call.id === f.id)).toHaveLength(1);
  expect(f.state().pauseReason).toBeUndefined();
});

it("fences a pre-retry read deferral if the lease expires", async () => {
  const f = await fixture("row");
  f.onReadFailure(() => {f.clock.now += LEASE_MS + 1;});
  await expect(f.step()).rejects.toMatchObject({code: "stale_worker"});
  expect(f.calls).toHaveLength(1);
  expect(f.current().rowRetries ?? []).toHaveLength(0);
  expect(f.state().tasks.find((task: {jobId: string}) => task.jobId === f.id).status).toBe("running");
});

it("fences a pre-retry read deferral after ownership changes", async () => {
  const f = await fixture("row");
  f.onReadFailure(() => {const state = f.state(); state.tasks.find((task: {jobId: string}) => task.jobId === f.id).lease.owner = "new-owner"; f.saveState(state);});
  await expect(f.step()).rejects.toMatchObject({code: "stale_worker"});
  expect(f.calls).toHaveLength(1);
  expect(f.state().tasks.find((task: {jobId: string}) => task.jobId === f.id).lease.owner).toBe("new-owner");
});

it("does not release a dispatched slot after a pre-retry read failure", async () => {
  const f = await fixture("row");
  f.onReadFailure(() => {
    const state = f.state(), task = state.tasks.find((task: {jobId: string}) => task.jobId === f.id);
    state.providerSlots.push({jobId: f.id, owner: task.lease.owner, leaseId: task.lease.leaseId, key: "unconfirmed", startedAt: f.clock.now, dispatched: true, unknown: true});
    f.saveState(state);
  });
  await expect(f.step()).rejects.toMatchObject({code: "outcome_unknown"});
  expect(f.calls).toHaveLength(1);
  expect(f.state().providerSlots).toMatchObject([{key: "unconfirmed", dispatched: true, unknown: true}]);
  expect(f.current().rowRetries ?? []).toHaveLength(0);
});

it("does not treat an unclassified read error as a confirmed abort", async () => {
  const f = await fixture("row", 1, false, Error("unknown database failure"));
  expect(await f.step()).toBe("failed");
  expect(await f.step()).toBe("failed");
  expect(f.calls).toHaveLength(1);
  expect(f.state().pauseReason).toBe("outcome_unknown");
});

it("preserves another task's unknown slot while deferring a read", async () => {
  const f = await fixture("row");
  const old = {jobId: f.jobs[2].id, owner: "old-owner", leaseId: "old-lease", key: "attempt:old", startedAt: f.clock.now - 1000, dispatched: true, unknown: true};
  f.saveState({...f.state(), providerSlots: [old]});
  expect(await f.step()).toBe("yielded");
  expect(f.state().providerSlots).toEqual([old]);
  expect(f.calls).toHaveLength(1);
  expect(f.state().pauseReason).toBeUndefined();
});

it("does not retry after job expiry or clear its recorded unknown costs", async () => {
  const f = await fixture("row");
  f.onReadFailure(() => {
    f.clock.now = f.current().expiresAt + 1;
    const state = f.state();
    state.tasks.find((task: {jobId: string}) => task.jobId === f.id).lease.until = f.clock.now + LEASE_MS;
    f.saveState(state);
  });
  expect(await f.step()).toBe("failed");
  expect(f.calls).toHaveLength(1);
  expect(f.current().rowRetries ?? []).toHaveLength(0);
  expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[f.id].unknown).toBe(true);
  expect(f.state().queue).not.toContain(f.id);
  expect(f.state().pauseReason).toBeUndefined();
});

it("reports later cleanup errors after handling the snapshot abort", async () => {
  const f = await fixture("row"), cleanup = Error("cleanup failed");
  f.failCleanup(cleanup);
  const errors: {error: unknown; phase: string}[] = [];
  await runWorkerPool({maxActiveJobs: 1, once: true, signal: new AbortController().signal, runOnce: f.run,
    onError: (error, context) => errors.push({error, phase: context.phase})});
  expect(errors).toEqual([{error: f.readError, phase: "intent"}, {error: cleanup, phase: "workspace_cleanup"}]);
  expect(f.calls).toHaveLength(1);
  expect(f.state().pauseReason).toBeUndefined();
});
