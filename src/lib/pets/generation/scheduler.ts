import {randomUUID} from "node:crypto";
import {LEASE_MS, GenerationError, generationQueueLimit, schedulerSchema, type GenerationJob, type Scheduler, type ParallelScheduler, type WorkerLease, type TaskScheduler} from "@/lib/pets/generation/model";
import type {GenerationTransaction} from "@/lib/pets/generation/store";
import {settleBudget} from "@/lib/pets/generation/budget";
import {configuredProviderCalls} from "@/lib/pets/generation/execution-limits";
import {recoverUnconfirmedCardMetadata} from "@/lib/pets/generation/card-metadata";

const SCHEDULER_EXPIRY = Date.UTC(2099, 0, 1);
export const isParallelScheduler = (state: Scheduler): state is ParallelScheduler => "version" in state;
export const isTaskScheduler = (state: Scheduler): state is TaskScheduler => "version" in state && state.version === 3;
export function activeLease(state: Scheduler, id: string, leaseId?: string) {
  if (isTaskScheduler(state)) return state.tasks.find(t => t.jobId === id && t.status === "running" && (!leaseId || t.lease?.leaseId === leaseId))?.lease;
  return isParallelScheduler(state) ? state.active.find(a => a.id === id) : state.active?.id === id ? state.active : undefined;
}
export function setActiveLease(state: Scheduler, lease: WorkerLease) {
  if (isTaskScheduler(state)) {
    const task = state.tasks.find(t => t.jobId === lease.id && t.lease?.leaseId === lease.leaseId);
    if (!task || !lease.leaseId) throw new GenerationError("stale_worker");
    task.lease = {...lease, leaseId: lease.leaseId}; return;
  }
  if (isParallelScheduler(state)) {
    if (!lease.leaseId) throw new GenerationError("stale_worker");
    state.active = [...state.active.filter(a => a.id !== lease.id), {...lease, leaseId: lease.leaseId}];
  } else state.active = lease;
}
export function releaseActiveLease(state: Scheduler, id: string) {
  if (isTaskScheduler(state)) {
    state.tasks = state.tasks.filter(t => t.jobId !== id); state.queue = state.queue.filter(key => key !== id);
    state.providerSlots = state.providerSlots.filter(s => s.jobId !== id || s.unknown); delete state.resumes[id]; return;
  }
  if (isParallelScheduler(state)) {
    state.active = state.active.filter(a => a.id !== id);
    state.providerWaiters = state.providerWaiters.filter(w => w.jobId !== id);
  } else if (state.active?.id === id) state.active = null;
}
export function requireQueueCapacity(state: Scheduler) {
  if (process.env.PET_GENERATION_DRAIN === "true") throw new GenerationError("generation_paused");
  const limit = generationQueueLimit();
  const initial = isParallelScheduler(state) ? state.queue.filter(id => state.resumes[id] === undefined).length : state.queue.length;
  if (initial >= limit || (isParallelScheduler(state) && state.queue.length + state.active.length >= limit + state.activeLimit)) throw new GenerationError("queue_full");
}
export class WorkerYield extends Error {
  constructor(readonly eligibleAt = 0) { super("Worker slice complete"); }
}
export async function scheduler(tx: GenerationTransaction, now: number): Promise<Scheduler> {
  const raw = await tx.getLedger("scheduler", now);
  return raw ? schedulerSchema.parse(JSON.parse(raw)) : { revision: 0, queue: [], active: null };
}
export async function saveScheduler(tx: GenerationTransaction, state: Scheduler) {
  state.revision += 1;
  await tx.putLedger("scheduler", JSON.stringify(state), SCHEDULER_EXPIRY);
}

export async function expireQueue(tx: GenerationTransaction, state: Scheduler, now: number) {
  if (!state.queue.length) return;
  const jobs = await tx.getJobs(state.queue);
  const ready: string[] = [];
  for (const id of state.queue) {
    const job = jobs.get(id);
    if (!job || job.expiresAt <= now) {
      if (isParallelScheduler(state)) delete state.resumes[id];
      const running = isTaskScheduler(state) && state.tasks.some(task => task.jobId === id && task.status === "running");
      // Running task leases own late-result accounting, even after the job's TTL deletes its row.
      if (!running) {
        const unknown = isTaskScheduler(state) && state.providerSlots.some(slot => slot.jobId === id && slot.dispatched !== false);
        await settleBudget(tx, id, now, unknown);
      }
      continue;
    }
    if (isTaskScheduler(state) && ["generating", "processing"].includes(job.status)) { ready.push(id); continue; }
    if (isParallelScheduler(state) && state.resumes[id] !== undefined) {
      if (job.status === "generating" || job.status === "processing") ready.push(id);
      else delete state.resumes[id];
      continue;
    }
    if (job.status !== "queued") continue;
    ready.push(id);
  }
  state.queue = ready;
  if (isTaskScheduler(state)) state.tasks = state.tasks.filter(task => ready.includes(task.jobId) || task.status === "running" || state.providerSlots.some(slot => slot.jobId === task.jobId) || state.heavy?.jobId === task.jobId);
}

export async function requireJobWithActiveWorkerLease(tx: GenerationTransaction, state: Scheduler, job: GenerationJob, now: number) {
  const current = await tx.getJob(job.id);
  const lease = activeLease(state, job.id, job.workerLeaseId);
  if (isTaskScheduler(state)) {
    const task = state.tasks.find(t => t.key === job.workerTask?.key && t.lease?.leaseId === job.workerLeaseId);
    if (!current || current.expiresAt <= now || !task || task.status !== "running" || !lease || lease.owner !== job.worker || lease.until <= now) throw new GenerationError("stale_worker");
    if (job.workerTask?.kind !== task.kind || job.workerTask?.stage !== task.stage) throw new GenerationError("stale_worker");
    return {...current, worker: job.worker, workerLeaseId: job.workerLeaseId, leaseUntil: lease.until,
      workerTask: {key: task.key, kind: task.kind, ...(task.stage ? {stage: task.stage} : {})}, executionVersion: 3 as const};
  }
  if (!current || current.expiresAt <= now || current.worker !== job.worker || !lease || lease.owner !== job.worker || lease.until <= now ||
    (isParallelScheduler(state) && (!job.workerLeaseId || current.workerLeaseId !== job.workerLeaseId || lease.leaseId !== job.workerLeaseId))) throw new GenerationError("stale_worker");
  return current;
}

export async function claimParallel(tx: GenerationTransaction, state: ParallelScheduler, owner: string, clock: () => number) {
  const leaseId = randomUUID();
  for (const lease of [...state.active]) {
    if (lease.until > clock()) continue;
    const slots = state.providerSlots.filter(s => s.jobId === lease.id);
    if (slots.length) {
      state.pauseReason = "outcome_unknown";
      for (const slot of slots) slot.unknown = true;
      await settleBudget(tx, lease.id, clock(), true);
      const job = await tx.getJob(lease.id);
      if (job && job.expiresAt > clock() && job.status === "processing" && job.cardMetadata &&
          ["inflight", "completed", "failed"].includes(job.cardMetadata.state) && slots.every(slot => slot.key === `card:${job.cardMetadata!.requestHash}`)) {
        await tx.putJob({...job, cardMetadata:recoverUnconfirmedCardMetadata(job.cardMetadata), worker:"", workerLeaseId:undefined, leaseUntil:undefined});
        releaseActiveLease(state, lease.id);
        if (!state.queue.includes(job.id)) state.queue.push(job.id);
        state.resumes[job.id] = 0;
      }
      continue;
    }
    // An unconfirmed local operation keeps its lock, but is not unknown spending.
    // Its exact owner can release it on completion even after the job lease expires.
    if (state.heavy?.jobId === lease.id) continue;
    const job = await tx.getJob(lease.id);
    releaseActiveLease(state, lease.id);
    if (job && job.expiresAt > clock() && ["generating", "processing"].includes(job.status)) {
      if (!state.queue.includes(job.id)) state.queue.push(job.id);
      state.resumes[job.id] = 0;
    } else await settleBudget(tx, lease.id, clock());
  }
  if (process.env.PET_GENERATION_DRAIN === "true" || state.active.length >= state.activeLimit) {
    await saveScheduler(tx, state); return null;
  }
  const configured = process.env.PET_GENERATION_ACTIVE_JOBS ?? "1";
  if (configured !== String(state.activeLimit)) throw new GenerationError("generation_not_configured");
  try {
    if (configuredProviderCalls(11) !== state.providerLimit) throw new Error("Provider limit mismatch");
  } catch { throw new GenerationError("generation_not_configured"); }
  for (const id of [...state.queue]) {
    if ((state.resumes[id] ?? 0) > clock()) continue;
    const job = await tx.getJob(id), now = clock();
    if (!job || job.expiresAt <= now) {
      state.queue = state.queue.filter(item => item !== id); delete state.resumes[id];
      await settleBudget(tx, id, now); continue;
    }
    if (state.pauseReason && (job.status !== "processing" || !job.cardMetadata || !["failed", "completed"].includes(job.cardMetadata.state))) continue;
    state.queue = state.queue.filter(item => item !== id);
    delete state.resumes[id];
    const claimed: GenerationJob = {...job, status: job.status === "queued" ? "generating" : job.status, worker: owner, workerLeaseId: leaseId, leaseUntil: now + LEASE_MS};
    setActiveLease(state, {id, owner, leaseId, until: now + LEASE_MS, inflight: false});
    await tx.putJob(claimed); await saveScheduler(tx, state); return claimed;
  }
  await saveScheduler(tx, state); return null;
}

export async function yieldParallel(tx: GenerationTransaction, state: Scheduler, job: GenerationJob, now: number, eligibleAt: number) {
  const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
  if (!isParallelScheduler(state)) throw new GenerationError("invalid_stage");
  if (state.providerSlots.some(s => s.jobId === job.id) || state.heavy?.jobId === job.id) throw new GenerationError("outcome_unknown");
  releaseActiveLease(state, job.id);
  state.queue.push(job.id); state.resumes[job.id] = Math.max(0, eligibleAt);
  await tx.putJob({...current, worker: "", workerLeaseId: undefined, leaseUntil: undefined});
  await saveScheduler(tx, state);
}

export async function readActiveWorkerJob(store: import("./store").GenerationStore, job: GenerationJob, now: number) {
  if (!job.workerTask) {
    const current = await store.readJob(job.id);
    if (!current || current.expiresAt <= now || current.worker !== job.worker || current.workerLeaseId !== job.workerLeaseId || !current.leaseUntil || current.leaseUntil <= now) throw new GenerationError("stale_worker");
    return current;
  }
  return store.transaction(async tx => requireJobWithActiveWorkerLease(tx, await scheduler(tx, now), job, now));
}

export function requireActiveWorkerLease(state: Scheduler, job: GenerationJob, now: number) {
  const lease = activeLease(state, job.id, job.workerLeaseId);
  if (!lease || lease.owner !== job.worker || lease.until <= now || (isParallelScheduler(state) && lease.leaseId !== job.workerLeaseId)) throw new GenerationError("stale_worker");
  if (isTaskScheduler(state)) {
    const task = state.tasks.find(t => t.key === job.workerTask?.key && t.status === "running" && t.lease?.leaseId === job.workerLeaseId);
    if (!task || task.kind !== job.workerTask?.kind || task.stage !== job.workerTask?.stage) throw new GenerationError("stale_worker");
  }
}
