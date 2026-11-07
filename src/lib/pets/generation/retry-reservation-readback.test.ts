import {afterEach, expect, it, vi} from "vitest";
import {StatusCode, YdbError} from "@/lib/ydb/client";
import {GenerationError, LEASE_MS, STAGE_NAMES} from "@/lib/pets/generation/model";
import {latestAnimationAttempt} from "@/lib/pets/generation/animation-repair";
import {latestBaseAttempt} from "@/lib/pets/generation/base-repair";
import {recoverRetryReservation} from "@/lib/pets/generation/retry-reservation-recovery";
import {readActiveWorkerJob, WorkerYield} from "@/lib/pets/generation/scheduler";
import {taskFixture} from "@/lib/pets/generation/task-pool.test-utils";
import {createWorkerContext, withWorkerContext} from "@/lib/pets/generation/worker-diagnostics";

type Kind = "animation" | "base" | "row";
class Aborted extends YdbError {static status = StatusCode.ABORTED;}
afterEach(() => {vi.restoreAllMocks(); vi.unstubAllEnvs();});

async function fixture(kind: Kind) {
  const f = await taskFixture(20, kind !== "row"), id = f.jobs[0].id;
  if (kind !== "base") f.saved(0, STAGE_NAMES.filter(stage => stage !== "idle"));
  else f.store.jobs.set(id, {...f.jobs[0], reviewBase: true, baseRetrySourceId: "b".repeat(64),
    baseRepair: {policy: 1, maxAttempts: 4, phase: "active", attempts: []}});
  f.store.ledger.get("scheduler")!.value = JSON.stringify({...JSON.parse(f.store.ledger.get("scheduler")!.value), queue: [id]});
  const job = (await f.service.claim("owner"))!, stage = kind === "base" ? "base" : "idle";
  await f.service.beginStage(job, stage);
  const initial = await readActiveWorkerJob(f.store, job, () => f.clock.now);
  const failure = new GenerationError("outcome_unknown", undefined, undefined, undefined,
    {boundary: "provider_cli", reason: "process_exit"}, {kind: "http_error", httpStatus: 520});
  if (kind === "base") {
    const token = latestBaseAttempt(initial)!.token;
    await f.service.startBaseAttempt(job, token);
    await f.service.failBaseAttempt(job, token, failure);
  } else if (kind === "animation") {
    const token = latestAnimationAttempt(initial, "idle")!.token;
    await f.service.startAnimationAttempt(job, "idle", token);
    await f.service.failAnimationAttempt(job, "idle", token, failure);
  } else {
    await f.service.authorizeStage(job, stage);
    await f.service.recordRowAttemptFailure(job, stage, 1, failure);
  }
  const before = await readActiveWorkerJob(f.store, job, () => f.clock.now);
  const request: Parameters<typeof recoverRetryReservation>[2] = kind === "base"
    ? {kind, stage: "base", reason: "transport"} : kind === "animation"
      ? {kind, stage: "idle", reason: "transport"} : {kind, stage: "idle"};
  const reserve = () => kind === "base" ? f.service.reserveBaseAttempt(job, "transport")
    : kind === "animation" ? f.service.reserveAnimationAttempt(job, "idle", "transport") : f.service.beginRowRetry(job, stage);
  const recover = (error: unknown = new Aborted("reservation aborted")) => recoverRetryReservation(f.store, before, request, error, () => f.clock.now);
  const state = () => JSON.parse(f.store.ledger.get("scheduler")!.value);
  const saveState = (next: ReturnType<typeof state>) => {f.store.ledger.get("scheduler")!.value = JSON.stringify(next);};
  return {...f, id, before, request, reserve, recover, state, saveState};
}

it.each(["animation", "base", "row"] as const)("readback of %s is read-only and preserves other unknown slots", async kind => {
  const f = await fixture(kind);
  const old = {jobId: f.jobs[1].id, owner: "old-owner", leaseId: "old-lease", key: "attempt:old", startedAt: f.clock.now - 1000, dispatched: true, unknown: true};
  f.saveState({...f.state(), providerSlots: [old]});
  const jobs = structuredClone(f.store.jobs), ledger = structuredClone(f.store.ledger);
  await expect(f.recover()).rejects.toBeInstanceOf(WorkerYield);
  expect(f.store.jobs).toEqual(jobs);
  expect(f.store.ledger).toEqual(ledger);
});

it.each(["animation", "base", "row"] as const)("refuses %s recovery if its earlier failure changed", async kind => {
  const f = await fixture(kind);
  await f.reserve();
  const current = f.store.jobs.get(f.id)!;
  if (kind === "row") current.rowAttemptLogs![0].at++;
  else {
    const attempt = kind === "base" ? current.baseRepair!.attempts[0] : current.animationRepair!.attempts.find(attempt => attempt.state === "idle")!;
    attempt.failure!.diagnostic = {boundary: "renderer_process", reason: "unclassified"};
  }
  await expect(f.recover(Error("lost acknowledgement"))).rejects.toMatchObject({code: "outcome_unknown", diagnostic: {boundary: "intent"}});
});

it.each(["animation", "base", "row"] as const)("refuses %s recovery when its slot may already have been dispatched", async kind => {
  const f = await fixture(kind);
  await f.reserve();
  f.saveState({...f.state(), providerSlots: [{jobId: f.id, owner: f.before.worker, leaseId: f.before.workerLeaseId,
    key: "unexpected-operation", startedAt: f.clock.now, dispatched: true}]});
  await expect(f.recover()).rejects.toMatchObject({code: "outcome_unknown"});
});

it.each(["animation", "base", "row"] as const)("checks %s lease expiry again after asynchronous readback", async kind => {
  const f = await fixture(kind);
  await f.reserve();
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(async operation => {
    const result = await transaction(operation); f.clock.now += LEASE_MS + 1; return result;
  });
  await expect(f.recover(Error("lost acknowledgement"))).rejects.toMatchObject({code: "stale_worker"});
});

it.each(["owner", "task", "pause"] as const)("refuses a reservation readback after a changed %s", async change => {
  const f = await fixture("animation");
  await f.reserve();
  const state = f.state();
  if (change === "owner") state.tasks[0].lease.owner = "replacement-owner";
  if (change === "task") state.tasks[0].stage = "waving";
  if (change === "pause") state.pauseReason = "outcome_unknown";
  f.saveState(state);
  await expect(f.recover()).rejects.toMatchObject({code: change === "pause" ? "outcome_unknown" : "stale_worker"});
});

it("rejects a committed reservation with a different source hash", async () => {
  const f = await fixture("animation");
  await f.reserve();
  f.store.jobs.get(f.id)!.animationRepair!.attempts.at(-1)!.sourceSha256 = "c".repeat(64);
  await expect(f.recover()).rejects.toMatchObject({code: "outcome_unknown"});
});

it("keeps the original database error and secondary readback failure", async () => {
  const f = await fixture("animation"), original = new Aborted("reserve aborted"), secondary = Error("readback failed");
  const events: {error: unknown; secondary: boolean}[] = [];
  const context = createWorkerContext("owner", (error, _context, secondary) => events.push({error, secondary}));
  vi.spyOn(f.store, "transaction").mockRejectedValueOnce(secondary);
  await expect(withWorkerContext(context, () => f.recover(original))).rejects.toMatchObject({code: "outcome_unknown"});
  expect(events).toEqual([{error: original, secondary: false}, {error: secondary, secondary: true}]);
});

it.each([1, 2])("does not enable v3 rollback deferral for legacy scheduler v%s", async version => {
  const f = await fixture("animation"), state = f.state();
  const lease = state.tasks[0].lease;
  f.store.jobs.set(f.id, {...f.store.jobs.get(f.id)!, worker: lease.owner, workerLeaseId: lease.leaseId, leaseUntil: lease.until});
  f.saveState(version === 1 ? {revision: 0, queue: [], active: lease}
    : {...state, version: 2, queue: [], active: [lease], tasks: undefined, taskTurn: undefined});
  await expect(f.recover()).rejects.toMatchObject({code: "outcome_unknown"});
  await f.reserve();
  await expect(f.recover(Error("lost acknowledgement"))).resolves.toMatchObject({notBefore: f.clock.now + 5000});
});

it("resets handled-error suppression after successful readback and safe deferral", async () => {
  const f = await fixture("animation"), context = createWorkerContext("owner", () => {});
  await expect(withWorkerContext(context, () => f.recover())).rejects.toBeInstanceOf(WorkerYield);
  expect(context.primaryReported).toBe(false);
  await f.reserve();
  await expect(withWorkerContext(context, () => f.recover(Error("lost acknowledgement")))).resolves.toMatchObject({notBefore: f.clock.now + 5000});
  expect(context.primaryReported).toBe(false);
});

it.each(["animation", "base"] as const)("does not bypass a changed %s retry limit", async kind => {
  const f = await fixture(kind);
  if (kind === "base") f.store.jobs.get(f.id)!.baseRepair!.maxAttempts = 1;
  else f.store.jobs.get(f.id)!.animationRepair = {...f.store.jobs.get(f.id)!.animationRepair!, policy: 2, maxAttempts: 1};
  await expect(f.recover()).rejects.toMatchObject({code: "outcome_unknown"});
});

it("keeps a changed configured policy and its persisted limit intact", async () => {
  const f = await fixture("animation");
  const repair = f.store.jobs.get(f.id)!.animationRepair!;
  repair.policy = 2; repair.maxAttempts = 7;
  f.before.animationRepair = structuredClone(repair);
  await f.reserve();
  await expect(f.recover()).resolves.toMatchObject({notBefore: f.clock.now + 5000});
  expect(f.store.jobs.get(f.id)!.animationRepair).toMatchObject({policy: 2, maxAttempts: 7});
});
