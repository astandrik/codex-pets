import {currentWorkerContext,setWorkerPhase} from "@/lib/pets/generation/worker-diagnostics";
import {WorkerYield} from "@/lib/pets/generation/scheduler";
import { GenerationError, type GenerationJob } from "@/lib/pets/generation/model";
import type { GenerationCardProvider } from "@/lib/pets/generation/card-provider";
import type { createGenerationService } from "@/lib/pets/generation/service";
import type { GenerationStore } from "@/lib/pets/generation/store";

type Service = ReturnType<typeof createGenerationService>;

export async function prepareGeneratedCard(
  job: GenerationJob,
  source: Buffer,
  service: Service,
  store: GenerationStore,
  provider: GenerationCardProvider | undefined,
  checkLease: () => void,
  now: () => number,
  stopping: () => boolean = () => false,
): Promise<GenerationJob> {
  if (!job.cardMetadata || ["completed", "failed"].includes(job.cardMetadata.state)) return job;
  const owner = job.worker, leaseId = job.workerLeaseId;
  if (stopping()) throw new WorkerYield();
  if (job.cardMetadata.state === "inflight" && !job.workerLeaseId) return service.failCardMetadata(job, "outcome_unknown");
  if (!provider) return service.failCardMetadata(job, "metadata_unavailable");

  let request: Awaited<ReturnType<GenerationCardProvider["prepare"]>>;
  try {
    request = await (job.workerLeaseId ? service.withHeavy(job, () => provider.prepare(job, source)) : provider.prepare(job, source));
  } catch (error) {
    if (error instanceof WorkerYield) throw error;
    return service.failCardMetadata(job, "metadata_unavailable");
  }
  checkLease();
  if (stopping()) throw new WorkerYield();
  try {
    if (job.cardMetadata.state !== "inflight") job = await service.beginCardMetadata(job, request.requestHash);
    else if (job.cardMetadata.requestHash !== request.requestHash) throw new GenerationError("metadata_already_started");
  } catch (error) {
    if (error instanceof GenerationError) {
      if (error.code === "budget_exhausted" || error.code === "generation_disabled") {
        return service.failCardMetadata(job, error.code);
      }
      throw error;
    }
    const saved = (job.workerTask ? await service.readWorkerJob(job) : requireOwnedJob(await store.readJob(job.id), owner, leaseId));
    const matchingCheckpoint = saved.status === "processing" &&
      saved.cardMetadata?.state === "inflight" &&
      saved.cardMetadata.requestHash === request.requestHash;
    if (!matchingCheckpoint) return service.failCardMetadata(job, "outcome_unknown");
    job = saved;
  }

  try {
    checkLease();
    if (stopping()) throw new WorkerYield();
    await service.authorizeCardMetadata(job);
    checkLease();
    if (stopping()) {await service.deferUnsentCardMetadata(job); throw new WorkerYield();}
    setWorkerPhase(currentWorkerContext(),"provider",job);
    const response = await provider.generate(request);
    try {
      return await service.saveCardMetadata(job, response);
    } catch (error) {
      if (error instanceof GenerationError && error.code === "generation_expired") throw error;
      if (job.expiresAt <= now()) {
        if (error instanceof GenerationError && error.code === "stale_worker") throw error;
        throw new GenerationError("outcome_unknown", undefined, undefined, undefined, {boundary:"checkpoint",reason:"unconfirmed_write"});
      }
      const saved = job.workerTask ? await service.readWorkerJob(job) : requireOwnedJob(await store.readJob(job.id), owner, leaseId);
      if (saved.cardMetadata?.state === "completed" && saved.cardMetadata.responseHash === response.responseHash) {
        return saved;
      }
      return service.failCardMetadata(job, "outcome_unknown");
    }
  } catch (error) {
    if (error instanceof WorkerYield || (error instanceof GenerationError && ["stale_worker", "generation_expired"].includes(error.code))) throw error;
    const knownFailure = error instanceof GenerationError &&
      ["provider_rejected", "metadata_unavailable", "budget_exhausted", "generation_disabled"].includes(error.code);
    return service.failCardMetadata(job, knownFailure ? error.code : "outcome_unknown");
  }
}

function requireOwnedJob(saved: GenerationJob | null, owner: string, leaseId?: string): GenerationJob {
  if (saved?.worker !== owner || saved.workerLeaseId !== leaseId) throw new GenerationError("stale_worker");
  return saved;
}
