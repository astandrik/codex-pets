import {z} from "zod";
import {createHash} from "node:crypto";
import {YdbError} from "@/lib/ydb/client";
import {DAY, GenerationError, STAGE_NAMES, type GenerationJob, type ImageUsage, type Scheduler, type StageName} from "@/lib/pets/generation/model";
import {REGENERATION_RETRIES} from "@/lib/pets/generation/continuation-model";
import {recordStageCost, settleBudget} from "@/lib/pets/generation/budget";
import {requireActiveWorkerLease, saveScheduler, scheduler, isTaskScheduler, isParallelScheduler, releaseActiveLease} from "@/lib/pets/generation/scheduler";
import type {GenerationStore, GenerationTransaction} from "@/lib/pets/generation/store";

export type ResultReceipt = {key: string; fingerprint: string};
const receiptSchema = z.object({
  results: z.record(z.string().max(128), z.string().regex(/^[a-f0-9]{64}$/)),
  finalizedBy: z.string().optional(),
  finalizedTasks: z.record(z.string(), z.string()).optional(),
}).strict();
type Receipt = z.infer<typeof receiptSchema>;
const MAX_RESULT_RECEIPTS = STAGE_NAMES.length * (REGENERATION_RETRIES.max + 1) + 2;
const key = (job: GenerationJob) => `generation-results:${job.id}`;
async function read(tx: GenerationTransaction, job: GenerationJob, now: number): Promise<Receipt> {
  const raw = await tx.getLedger(key(job), now);
  return raw ? receiptSchema.parse(JSON.parse(raw)) : {results: {}};
}
async function write(tx: GenerationTransaction, job: GenerationJob, receipt: Receipt) {
  // Only accounting hashes survive the task; no image, prompt or task TTL is extended.
  await tx.putLedger(key(job), JSON.stringify(receipt), job.createdAt + 7 * DAY);
}
function matches(receipt: Receipt, result: ResultReceipt) {
  const previous = Object.hasOwn(receipt.results, result.key) ? receipt.results[result.key] : undefined;
  if (previous && previous !== result.fingerprint) throw new GenerationError("stage_conflict");
  return previous !== undefined;
}

export async function recordResultCost(tx: GenerationTransaction, job: GenerationJob, now: number, result: ResultReceipt, usage?: Pick<ImageUsage,"costUsd">, name?: StageName | "card") {
  if (usage && (!Number.isFinite(usage.costUsd) || usage.costUsd < 0 || !Number.isSafeInteger(Math.ceil(usage.costUsd * 1_000_000)))) throw new GenerationError("invalid_provider_result");
  const receipt = await read(tx, job, now);
  if (matches(receipt, result)) return;
  if (receipt.finalizedBy !== undefined || (job.workerLeaseId && receipt.finalizedTasks?.[job.workerLeaseId] !== undefined)) throw new GenerationError("stale_worker");
  if (Object.keys(receipt.results).length >= MAX_RESULT_RECEIPTS) throw new GenerationError("invalid_stage");
  if (!await recordStageCost(tx, job.id, now, usage, name)) throw new GenerationError("outcome_unknown");
  receipt.results[result.key] = result.fingerprint;
  await write(tx, job, receipt);
}

export async function recordExpiredResult(tx: GenerationTransaction, state: Scheduler, job: GenerationJob, now: number, result: ResultReceipt, usage?: Pick<ImageUsage,"costUsd">, name?: StageName | "card") {
  if (job.expiresAt > now) return false;
  const receipt = await read(tx, job, now);
  if (receipt.finalizedBy !== undefined) {
    if (receipt.finalizedBy !== job.worker || !matches(receipt, result)) throw new GenerationError("stale_worker");
    return true;
  }
  if (job.workerTask && job.workerLeaseId && receipt.finalizedTasks?.[job.workerLeaseId] !== undefined) {
    if (receipt.finalizedTasks[job.workerLeaseId] !== job.worker || !matches(receipt, result)) throw new GenerationError("stale_worker");
    return true;
  }
  requireActiveWorkerLease(state, job, now);
  await recordResultCost(tx, job, now, result, usage, name);
  return true;
}

function logCheckpointFailure(job: GenerationJob, error: unknown, status: "retry" | "failed") {
  const databaseStatus = error instanceof YdbError ? Reflect.get(error.constructor, "status") : undefined;
  try {
    console.warn(JSON.stringify({operation: "pet-generation-checkpoint", status,
      targetHash: createHash("sha256").update(job.id).digest("hex"),
      stage: job.workerTask?.stage, task: job.workerTask?.kind,
      ...(Number.isSafeInteger(databaseStatus) ? {databaseStatus} : {})}));
  } catch { /* Diagnostics must not interrupt receipt recovery. */ }
}

export async function persistResult(job: GenerationJob, clock: () => number, save: () => Promise<GenerationJob | null>, expiredError = new GenerationError("generation_expired")): Promise<GenerationJob> {
  let result: GenerationJob | null;
  try { result = await save(); }
  catch (error) {
    if (error instanceof GenerationError) throw error;
    logCheckpointFailure(job, error, "retry");
    // Replay only the checkpoint, never the provider call. Receipts deduplicate
    // lost commit replies; each save rechecks the current lease and task expiry.
    if (job.expiresAt > clock()) await new Promise(resolve => setTimeout(resolve, 100));
    try { result = await save(); }
    catch (retryError) {logCheckpointFailure(job, retryError, "failed"); throw retryError;}
  }
  if (result === null) throw expiredError;
  return result;
}

export async function finishExpiredGeneration(store: GenerationStore, job: GenerationJob, clock: () => number, uncertain: boolean) {
  const finish = () => store.transaction(async tx => {
    const state = await scheduler(tx, clock());
    const now = clock();
    if (job.expiresAt > now) throw new GenerationError("invalid_stage");
    const receipt = await read(tx, job, now);
    if (receipt.finalizedBy !== undefined) {
      if (receipt.finalizedBy !== job.worker) throw new GenerationError("stale_worker");
      return;
    }
    if (isTaskScheduler(state) && job.workerTask && job.workerLeaseId) {
      const finalizedOwner = receipt.finalizedTasks?.[job.workerLeaseId];
      if (finalizedOwner !== undefined) {
        if (finalizedOwner !== job.worker) throw new GenerationError("stale_worker");
        return;
      }
      requireActiveWorkerLease(state, job, now);
      const slot = state.providerSlots.find(item => item.leaseId === job.workerLeaseId);
      if (slot && uncertain) {slot.unknown = true; state.pauseReason = "outcome_unknown";}
      else state.providerSlots = state.providerSlots.filter(item => item.leaseId !== job.workerLeaseId);
      state.tasks = state.tasks.filter(task => task.lease?.leaseId !== job.workerLeaseId);
      if (state.heavy?.leaseId === job.workerLeaseId) state.heavy = null;
      receipt.finalizedTasks = {...receipt.finalizedTasks, [job.workerLeaseId]: job.worker};
      const running = state.tasks.some(task => task.jobId === job.id && task.status === "running");
      if (uncertain || !running) await settleBudget(tx, job.id, now, uncertain || state.providerSlots.some(item => item.jobId === job.id && item.unknown));
      if (!running) {
        state.tasks = state.tasks.filter(task => task.jobId !== job.id);
        state.queue = state.queue.filter(id => id !== job.id);
        delete state.resumes[job.id];
      }
    } else {
      requireActiveWorkerLease(state, job, now);
      await settleBudget(tx, job.id, now, uncertain);
      receipt.finalizedBy = job.worker;
      if (isParallelScheduler(state)) {
        const slots = state.providerSlots.filter(slot => slot.jobId === job.id && slot.leaseId === job.workerLeaseId);
        if (uncertain) for (const slot of slots) slot.unknown = true;
        else state.providerSlots = state.providerSlots.filter(slot => !slots.includes(slot));
      }
      releaseActiveLease(state, job.id);
    }
    await write(tx, job, receipt);
    if (uncertain) state.pauseReason = "outcome_unknown";
    await saveScheduler(tx, state);
  });
  try { await finish(); }
  catch (error) {
    if (error instanceof GenerationError) throw error;
    await finish();
  }
}
