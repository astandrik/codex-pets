import {createHash} from "node:crypto";
import {GENERATION_ID, GenerationError, generationConfirmationSchema, generationAnimationHintsEnabled, type GenerationJob} from "@/lib/pets/generation/model";
import type {GenerationStore, GenerationTransaction} from "@/lib/pets/generation/store";
import {scheduler, saveScheduler, expireQueue, requireJobWithActiveWorkerLease} from "@/lib/pets/generation/scheduler";
import {settleBudget, startBudgetTracking} from "@/lib/pets/generation/budget";
import {publicJob} from "@/lib/pets/generation/public-job";

export async function readSavedGenerationBase(job: GenerationJob, read: GenerationTransaction["getArtifact"], now: number) {
  const stage = job.stages.find(stage => stage.name === "base" && stage.status === "completed");
  if (!stage) throw new GenerationError("base_not_ready");
  const bytes = await read(job.id, "stage-base.png", now);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== stage.sha256) throw new GenerationError("saved_stage_unavailable");
  return bytes;
}

export function createBaseReviewService(store: GenerationStore, options: {now: () => number; enabled: () => boolean; budgetUsd: () => number}) {
  function liveJob(id: string, job: GenerationJob | null, now: number): GenerationJob {
    if (!GENERATION_ID.test(id)) throw new GenerationError("invalid_argument");
    if (!job) throw new GenerationError("not_found");
    if (job.expiresAt <= now) throw new GenerationError("generation_expired");
    return job;
  }
  return {
    async getBase(id: string) {
      if (!GENERATION_ID.test(id)) throw new GenerationError("invalid_argument");
      const now = options.now();
      const job = liveJob(id, await store.readJob(id), now);
      const bytes = await readSavedGenerationBase(job, (jobId, kind, time) => store.readArtifact(jobId, kind, time), now);
      liveJob(id, job, options.now());
      return bytes;
    },
    async awaitConfirmation(job: GenerationJob) {
      const now = options.now();
      return store.transaction(async tx => {
        const state = await scheduler(tx, now);
        const current = await requireJobWithActiveWorkerLease(tx, state, job, now);
        if (!current.reviewBase || current.baseConfirmedAt !== undefined || current.status !== "generating" ||
            current.stages.length !== 1 || current.stages[0].name !== "base" || current.stages[0].status !== "completed") throw new GenerationError("base_not_ready");
        const updated: GenerationJob = {...current, status: "awaiting_confirmation", worker: "", leaseUntil: undefined};
        await tx.putJob(updated);
        await settleBudget(tx, job.id, now);
        state.active = null;
        await saveScheduler(tx, state);
        return updated;
      });
    },
    async confirm(id: string, input: unknown = {}) {
      if (!GENERATION_ID.test(id)) throw new GenerationError("invalid_argument");
      const parsed = generationConfirmationSchema.safeParse(input);
      if (!parsed.success) throw new GenerationError("invalid_argument");
      const animationPrompt = parsed.data.animationPrompt || undefined;
      try {
        return await store.transaction(async tx => {
          const saved = await tx.getJob(id);
          const now = options.now();
          const job = liveJob(id, saved, now);
          if (job.baseConfirmedAt !== undefined) return {generation: publicJob(job, now), newlyQueued: false};
          if (!job.reviewBase || job.status !== "awaiting_confirmation") throw new GenerationError("base_not_ready");
          if (animationPrompt && !generationAnimationHintsEnabled()) throw new GenerationError("animation_hints_disabled");
          await readSavedGenerationBase(job, tx.getArtifact, now);
          if (!options.enabled()) throw new GenerationError("generation_disabled");
          const state = await scheduler(tx, now);
          await expireQueue(tx, state, now);
          if (state.pauseReason) throw new GenerationError("generation_paused");
          if (state.queue.length >= 5) throw new GenerationError("queue_full");
          await startBudgetTracking(tx, id, now, options.budgetUsd());
          const decisionTime = options.now();
          liveJob(id, job, decisionTime);
          const updated: GenerationJob = {...job, status: "queued", baseConfirmedAt: decisionTime, queuedAt: decisionTime, ...(animationPrompt ? {animationPrompt} : {})};
          await tx.putJob(updated);
          state.queue.push(id);
          await saveScheduler(tx, state);
          return {generation: publicJob(updated, decisionTime), newlyQueued: true};
        });
      } catch (error) {
        if (!(error instanceof GenerationError)) {
          const saved = await store.readJob(id);
          if (saved && saved.expiresAt > options.now() && saved.baseConfirmedAt !== undefined) return {generation: publicJob(saved, options.now()), newlyQueued: false};
        }
        throw error;
      }
    },
  };
}
