import {z} from "zod";
import {DAY, GenerationError, type GenerationJob, type ImageUsage, type Scheduler, type StageName} from "@/lib/pets/generation/model";
import {recordStageCost, settleBudget} from "@/lib/pets/generation/budget";
import {requireActiveWorkerLease, saveScheduler, scheduler} from "@/lib/pets/generation/scheduler";
import type {GenerationStore, GenerationTransaction} from "@/lib/pets/generation/store";

export type ResultReceipt = {key: string; fingerprint: string};
const receiptSchema = z.object({
  results: z.record(z.string().max(128), z.string().regex(/^[a-f0-9]{64}$/)),
  finalizedBy: z.string().optional(),
}).strict();
type Receipt = z.infer<typeof receiptSchema>;
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
  if (receipt.finalizedBy !== undefined) throw new GenerationError("stale_worker");
  if (Object.keys(receipt.results).length >= 64) throw new GenerationError("invalid_stage");
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
  requireActiveWorkerLease(state, job, now);
  await recordResultCost(tx, job, now, result, usage, name);
  return true;
}

export async function persistResult(job: GenerationJob, clock: () => number, save: () => Promise<GenerationJob | null>, expiredError = new GenerationError("generation_expired")): Promise<GenerationJob> {
  let result: GenerationJob | null;
  try { result = await save(); }
  catch (error) {
    if (error instanceof GenerationError || job.expiresAt > clock()) throw error;
    // The accounting receipt makes a single retry safe after a lost commit reply.
    result = await save();
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
    requireActiveWorkerLease(state, job, now);
    await settleBudget(tx, job.id, now, uncertain);
    receipt.finalizedBy = job.worker;
    await write(tx, job, receipt);
    if (uncertain) state.pauseReason = "outcome_unknown";
    state.active = null;
    await saveScheduler(tx, state);
  });
  try { await finish(); }
  catch (error) {
    if (error instanceof GenerationError) throw error;
    await finish();
  }
}
