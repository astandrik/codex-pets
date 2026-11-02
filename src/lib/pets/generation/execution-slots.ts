import {GenerationError, type GenerationJob, type Scheduler, type StageName} from "@/lib/pets/generation/model";
import {activeLease, isTaskScheduler, isParallelScheduler, saveScheduler, WorkerYield} from "@/lib/pets/generation/scheduler";
import type {GenerationTransaction} from "@/lib/pets/generation/store";
import {configuredProviderCalls} from "@/lib/pets/generation/execution-limits";

export function stageOperation(job: GenerationJob, name: StageName) {
  const retry = job.rowRetries?.find(r => r.stage === name);
  return retry ? `retry:${retry.token}` : `stage:${name}`;
}

// Callers validate the stage, lease and budget in the same transaction.
// Capacity waiting is persisted without marking the attempt as started.
export async function tryStartProviderOperation(tx: GenerationTransaction, state: Scheduler, job: GenerationJob, key: string, now: number) {
  if (isTaskScheduler(state)) {
    const slot = state.providerSlots.find(s => s.jobId === job.id && s.leaseId === job.workerLeaseId);
    if (!slot || slot.unknown || slot.dispatched !== false) throw new GenerationError("outcome_unknown");
    let matchingConfiguration = false;
    try { matchingConfiguration = configuredProviderCalls() === state.providerLimit; } catch { /* Wait for valid operator configuration. */ }
    if (!matchingConfiguration || process.env.PET_GENERATION_DRAIN === "true" ||
        state.providerSlots.filter(s => s.dispatched !== false).length >= state.providerLimit) return false;
    slot.key = key; slot.dispatched = true; await saveScheduler(tx, state); return true;
  }
  if (!isParallelScheduler(state)) return true;
  if (!job.workerLeaseId) throw new GenerationError("stale_worker");
  if (state.providerSlots.some(s => s.jobId === job.id && s.key === key)) throw new GenerationError("outcome_unknown");
  state.providerWaiters = state.providerWaiters.filter(w => activeLease(state, w.jobId)?.leaseId === w.leaseId);
  if (!state.providerWaiters.some(w => w.jobId === job.id && w.key === key)) {
    state.providerWaiters.push({jobId: job.id, leaseId: job.workerLeaseId, key});
  }
  const turn = state.providerWaiters.find(w => w.jobId === state.providerTurn) ?? state.providerWaiters[0];
  if (state.providerSlots.length >= state.providerLimit || turn.jobId !== job.id) {
    await saveScheduler(tx, state); return false;
  }
  state.providerWaiters = state.providerWaiters.filter(w => !(w.jobId === job.id && w.key === key));
  state.providerSlots.push({jobId: job.id, owner: job.worker, leaseId: job.workerLeaseId, key, startedAt: now});
  state.providerTurn = (state.providerWaiters.find(w => w.jobId !== job.id) ?? state.providerWaiters[0])?.jobId ?? null;
  await saveScheduler(tx, state);
  return true;
}

export async function settleProviderOperation(tx: GenerationTransaction, state: Scheduler, job: GenerationJob, key: string, unknown = false) {
  if (!isParallelScheduler(state)) return;
  const slot = state.providerSlots.find(s => s.jobId === job.id && s.key === key && (!isTaskScheduler(state) || s.leaseId === job.workerLeaseId));
  if (!slot) return;
  if (slot.leaseId !== job.workerLeaseId) throw new GenerationError("stale_worker");
  if (unknown) {
    slot.unknown = true; state.pauseReason = "outcome_unknown";
  } else state.providerSlots = state.providerSlots.filter(s => s !== slot);
  state.providerTurn ??= state.providerWaiters[0]?.jobId ?? null;
  await saveScheduler(tx, state);
}

// Only the live caller that has not dispatched the request may return this permit.
export async function releaseUnsentProviderOperation(tx: GenerationTransaction, state: Scheduler, job: GenerationJob, key: string) {
  if (!isParallelScheduler(state)) throw new GenerationError("invalid_stage");
  const slot = state.providerSlots.find(s => s.jobId === job.id && s.key === key && (!isTaskScheduler(state) || s.leaseId === job.workerLeaseId));
  if (!slot || slot.unknown || slot.leaseId !== job.workerLeaseId || slot.owner !== job.worker) throw new GenerationError("outcome_unknown");
  await settleProviderOperation(tx, state, job, key);
}

export async function acquireHeavySlot(tx: GenerationTransaction, state: Scheduler, job: GenerationJob) {
  if (!isParallelScheduler(state)) return true;
  if (!job.workerLeaseId) throw new GenerationError("stale_worker");
  if (state.heavy) return isTaskScheduler(state) && state.heavy.leaseId === job.workerLeaseId;
  state.heavy = {jobId: job.id, owner: job.worker, leaseId: job.workerLeaseId};
  await saveScheduler(tx, state); return true;
}
export async function releaseHeavySlot(tx: GenerationTransaction, state: Scheduler, job: GenerationJob) {
  if (!isParallelScheduler(state)) return;
  if (state.heavy?.jobId !== job.id || state.heavy.leaseId !== job.workerLeaseId) throw new GenerationError("stale_worker");
  state.heavy = null; await saveScheduler(tx, state);
}

export function requireCapacity(acquired: boolean, eligibleAt = 0) {
  if (!acquired) { const error = new WorkerYield(eligibleAt); error.name = "WorkerYield"; throw error; }
}
