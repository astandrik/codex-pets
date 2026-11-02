import {isDeepStrictEqual} from "node:util";
import {YdbError, StatusCode} from "@/lib/ydb/client";
import {animationFailureRetryReason} from "@/lib/pets/generation/animation-repair";
import {baseFailureRetryReason} from "@/lib/pets/generation/base-repair";
import {isRetryableImageCause} from "@/lib/pets/generation/cli-cause";
import type {ContinuationState} from "@/lib/pets/generation/continuation-model";
import {GenerationError, type GenerationJob, type StageName} from "@/lib/pets/generation/model";
import {isTaskScheduler, readActiveWorkerJob, requireJobWithActiveWorkerLease, scheduler, WorkerYield} from "@/lib/pets/generation/scheduler";
import type {GenerationStore} from "@/lib/pets/generation/store";
import {currentWorkerContext, setWorkerPhase} from "@/lib/pets/generation/worker-diagnostics";

type Reservation =
  | {kind: "animation"; stage: ContinuationState; reason: "quality" | "transport" | "moderation"}
  | {kind: "base"; stage: "base"; reason: "transport" | "moderation" | "rate_limit"}
  | {kind: "row"; stage: StageName};
type Readback = {state: "unchanged"} | {state: "reserved"; notBefore: number};

// Only for reads before a provider operation. The task completion transaction
// fences a yielded task against its current lease and any dispatched slot.
export async function readRetrySnapshot(store: GenerationStore, job: GenerationJob, stage: StageName, now: () => number) {
  try {
    const current = await readActiveWorkerJob(store, job, now());
    if (current.expiresAt <= now() || current.leaseUntil === undefined || current.leaseUntil <= now()) throw new GenerationError("stale_worker");
    return current;
  } catch (error) {
    if (!(error instanceof YdbError) || Reflect.get(error.constructor, "status") !== StatusCode.ABORTED ||
      job.workerTask?.kind !== "image" || job.workerTask.stage !== stage) throw error;
    const context = currentWorkerContext();
    setWorkerPhase(context, "intent", job);
    context?.report(error);
    if (job.expiresAt <= now()) throw new GenerationError("generation_expired");
    if (context) context.primaryReported = false;
    throw new WorkerYield(now() + 5000);
  }
}

function reservationState(before: GenerationJob, current: GenerationJob, request: Reservation): Readback | undefined {
  if (current.status !== "generating" || !isDeepStrictEqual(
    before.stages.find(stage => stage.name === request.stage), current.stages.find(stage => stage.name === request.stage),
  )) return;
  if (request.kind === "row") {
    const logs = before.rowAttemptLogs?.filter(log => log.stage === request.stage) ?? [];
    const first = logs[0];
    if (logs.length !== 1 || first.attempt !== 1 || first.code !== "outcome_unknown" || !isRetryableImageCause(first.cliCause) ||
      !isDeepStrictEqual(logs, current.rowAttemptLogs?.filter(log => log.stage === request.stage)) ||
      before.rowRetries?.some(retry => retry.stage === request.stage)) return;
    const retries = current.rowRetries?.filter(retry => retry.stage === request.stage) ?? [];
    if (!retries.length) return {state: "unchanged"};
    if (retries.length === 1 && retries[0].state === "waiting") return {state: "reserved", notBefore: retries[0].notBefore};
    return;
  }
  if (request.kind === "base") {
    const previous = before.baseRepair, repair = current.baseRepair, last = previous?.attempts.at(-1);
    if (!previous || !repair || !last || repair.policy !== previous.policy || repair.maxAttempts !== previous.maxAttempts ||
      repair.phase !== previous.phase || last.ordinal >= previous.maxAttempts || last.status !== "failed" ||
      !last.failure || baseFailureRetryReason(last.failure) !== request.reason) return;
    if (isDeepStrictEqual(previous.attempts, repair.attempts)) return {state: "unchanged"};
    const next = repair.attempts.at(-1)!;
    if (repair.attempts.length === previous.attempts.length + 1 && isDeepStrictEqual(previous.attempts, repair.attempts.slice(0, -1)) &&
      next.status === "reserved" && next.ordinal === last.ordinal + 1 && next.reason === request.reason && next.token !== last.token) {
      return {state: "reserved", notBefore: next.notBefore};
    }
    return;
  }
  const previous = before.animationRepair, repair = current.animationRepair;
  if (!previous || !repair || repair.policy !== previous.policy || repair.maxAttempts !== previous.maxAttempts ||
    repair.phase !== previous.phase || repair.pending.includes(request.stage) !== previous.pending.includes(request.stage)) return;
  const oldAttempts = previous.attempts.filter(attempt => attempt.state === request.stage);
  const attempts = repair.attempts.filter(attempt => attempt.state === request.stage), last = oldAttempts.at(-1);
  if (!last || last.ordinal >= previous.maxAttempts) return;
  if (request.reason === "quality") {
    if (last.status !== "saved" || !last.usage || !last.resultSha256 || previous.phase !== "repairing" || !previous.pending.includes(request.stage)) return;
  } else if (last.status !== "failed" || !last.failure || animationFailureRetryReason(last.failure) !== request.reason) return;
  if (isDeepStrictEqual(oldAttempts, attempts)) return {state: "unchanged"};
  const next = attempts.at(-1)!;
  const sourceSha256 = request.reason === "quality" ? last.resultSha256 : last.sourceSha256;
  if (attempts.length === oldAttempts.length + 1 && isDeepStrictEqual(oldAttempts, attempts.slice(0, -1)) &&
    next.status === "reserved" && next.ordinal === last.ordinal + 1 && next.reason === request.reason &&
    next.token !== last.token && next.sourceSha256 === sourceSha256) return {state: "reserved", notBefore: next.notBefore};
}

// Reservation does not send a request. Reuse a committed reservation, or yield
// only after a definitive transaction rollback and unchanged persisted state.
export async function recoverRetryReservation(
  store: GenerationStore, before: GenerationJob, request: Reservation, error: unknown, now: () => number,
): Promise<{notBefore: number}> {
  const context = currentWorkerContext();
  setWorkerPhase(context, "intent", before);
  context?.report(error);
  const uncertain = () => new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary: "intent", reason: "unconfirmed_write"});
  let readback: {reservation: Readback; taskScheduler: boolean; leaseUntil: number; expiresAt: number} | undefined;
  try {
    readback = await store.transaction(async tx => {
      const time = now(), state = await scheduler(tx, time);
      const current = await requireJobWithActiveWorkerLease(tx, state, before, time);
      const taskScheduler = isTaskScheduler(state);
      if (state.pauseReason || current.leaseUntil === undefined) return;
      if (taskScheduler) {
        if (current.workerTask?.kind !== "image" || current.workerTask.stage !== request.stage) return;
        const slots = state.providerSlots.filter(slot => slot.jobId === before.id && slot.leaseId === before.workerLeaseId);
        if (slots.some(slot => slot.owner !== before.worker || slot.unknown || slot.dispatched !== false)) return;
      }
      const reservation = reservationState(before, current, request);
      if (reservation) return {reservation, taskScheduler, leaseUntil: current.leaseUntil, expiresAt: current.expiresAt};
    });
  } catch (readbackError) {
    context?.report(readbackError, true);
    if (readbackError instanceof GenerationError && ["stale_worker", "generation_expired"].includes(readbackError.code)) throw readbackError;
    throw uncertain();
  }
  if (readback && (readback.leaseUntil <= now() || readback.expiresAt <= now())) throw new GenerationError("stale_worker");
  if (readback?.reservation.state === "reserved") {
    if (context) context.primaryReported = false;
    return {notBefore: readback.reservation.notBefore};
  }
  if (readback?.taskScheduler && readback.reservation.state === "unchanged" && error instanceof YdbError &&
    Reflect.get(error.constructor, "status") === StatusCode.ABORTED) {
    if (context) context.primaryReported = false;
    throw new WorkerYield(now() + 5000);
  }
  throw uncertain();
}
