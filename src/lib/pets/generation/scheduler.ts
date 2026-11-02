import {GenerationError, generationQueueLimit, schedulerSchema, type GenerationJob, type Scheduler} from "@/lib/pets/generation/model";
import type {GenerationTransaction} from "@/lib/pets/generation/store";
import {settleBudget} from "@/lib/pets/generation/budget";

export function requireQueueCapacity(state: Scheduler) {
  if (state.queue.length >= generationQueueLimit()) throw new GenerationError("queue_full");
}

const SCHEDULER_EXPIRY = Date.UTC(2099, 0, 1);
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
    if (!job || job.expiresAt <= now) { await settleBudget(tx, id, now); continue; }
    if (job.status !== "queued") continue;
    ready.push(id);
  }
  state.queue = ready;
}

export async function requireJobWithActiveWorkerLease(tx: GenerationTransaction, state: Scheduler, job: GenerationJob, now: number) {
  const current = await tx.getJob(job.id);
  if (!current || current.expiresAt <= now || current.worker !== job.worker || state.active?.id !== job.id || state.active.owner !== job.worker || state.active.until <= now) throw new GenerationError("stale_worker");
  return current;
}

export function requireActiveWorkerLease(state: Scheduler, job: GenerationJob, now: number) {
  if (state.active?.id !== job.id || state.active.owner !== job.worker || state.active.until <= now) throw new GenerationError("stale_worker");
}
