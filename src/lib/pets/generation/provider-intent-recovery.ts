import {YdbError, StatusCode} from "@/lib/ydb/client";
import {latestAnimationAttempt, isAnimationState} from "@/lib/pets/generation/animation-repair";
import {latestBaseAttempt} from "@/lib/pets/generation/base-repair";
import {GenerationError, type GenerationJob, type StageName} from "@/lib/pets/generation/model";
import {isTaskScheduler, requireJobWithActiveWorkerLease, scheduler, WorkerYield} from "@/lib/pets/generation/scheduler";
import type {GenerationStore} from "@/lib/pets/generation/store";
import {currentWorkerContext, setWorkerPhase} from "@/lib/pets/generation/worker-diagnostics";

// Called only after start failed and before this worker can invoke the provider.
export async function recoverProviderIntent(
  store: GenerationStore,
  job: GenerationJob,
  stage: StageName,
  token: string,
  error: unknown,
  now: () => number,
): Promise<void> {
  const context = currentWorkerContext();
  setWorkerPhase(context, "intent", job);
  context?.report(error);
  const uncertain = () => new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary:"intent", reason:"unconfirmed_write"});
  let readback: {state: "started" | "reserved"; leaseUntil: number} | undefined;
  try {
    readback = await store.transaction(async tx => {
      const time = now(), currentScheduler = await scheduler(tx, time);
      if (!isTaskScheduler(currentScheduler)) return;
      const current = await requireJobWithActiveWorkerLease(tx, currentScheduler, job, time);
      if (current.workerTask?.kind !== "image" || current.workerTask.stage !== stage || current.leaseUntil === undefined) return;
      const attempt = stage === "base" ? latestBaseAttempt(current)
        : isAnimationState(stage) ? latestAnimationAttempt(current, stage) : undefined;
      const slot = currentScheduler.providerSlots.find(item => item.jobId === job.id && item.leaseId === job.workerLeaseId && item.owner === job.worker);
      if (currentScheduler.pauseReason || !attempt || attempt.token !== token || !slot || slot.unknown) return;
      const operation = `${stage === "base" ? "base-attempt" : "attempt"}:${token}`;
      if (attempt.status === "started" && slot.dispatched === true && slot.key === operation) return {state:"started", leaseUntil:current.leaseUntil};
      if (attempt.status === "reserved" && slot.dispatched === false) return {state:"reserved", leaseUntil:current.leaseUntil};
    });
  } catch (readbackError) {
    context?.report(readbackError, true);
    if (readbackError instanceof GenerationError && ["stale_worker", "generation_expired"].includes(readbackError.code)) throw readbackError;
    throw uncertain();
  }
  if (readback && readback.leaseUntil <= now()) throw new GenerationError("stale_worker");
  if (readback?.state === "started") {
    // The failed acknowledgement is resolved; later failures have their own cause.
    if (context) context.primaryReported = false;
    return;
  }
  if (readback?.state === "reserved" && error instanceof YdbError && Reflect.get(error.constructor, "status") === StatusCode.ABORTED) {
    if (context) context.primaryReported = false;
    throw new WorkerYield(now() + 5000);
  }
  throw uncertain();
}
