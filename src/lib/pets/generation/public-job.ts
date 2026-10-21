import {WAIT_MS, requiredStageNames, usesStageCheckpoints, isUnacceptedAnimationRevision, type GenerationJob} from "@/lib/pets/generation/model";
import type {PublicCardMetadata} from "@/lib/pets/generation/card-metadata";
import {publicGenerationError} from "@/lib/pets/generation/public-error";
import {toPublicUrl} from "@/lib/base-path";

export function publicJob(record: GenerationJob, now: number, metadata?:PublicCardMetadata) {
  let job = record;
  if (record.status === "queued" && (record.queuedAt ?? record.createdAt) + WAIT_MS <= now) {
    job = { ...record, status: "failed", error: "queue_timeout", prompt: "" };
  }
  if (record.status === "generating" && record.leaseUntil && record.leaseUntil <= now && (!usesStageCheckpoints(record) || record.stages.some(stage => stage.status === "inflight"))) {
    job = { ...record, status: "failed", error: "outcome_unknown" };
  }
  const root = `/api/pet-generations/${job.id}/files/`;
  return {
    generationId: job.id,
    status: job.status,
    progress: { completedSteps: job.pipelineVersion === 1 && job.status === "completed" ? 1 : job.stages.filter(stage => stage.status === "completed").length, totalSteps: usesStageCheckpoints(job) ? requiredStageNames(job).length : 1 },
    expiresAt: new Date(job.expiresAt).toISOString(),
    pollAfterSeconds: job.status === "queued" || job.status === "generating" || job.status === "processing" ? 5 : undefined,
    previewUrl: toPublicUrl(`/generated/${job.id}`),
    submission: job.submission,
    ...(job.reviewBase ? {reviewBase: true, baseConfirmed: job.baseConfirmedAt !== undefined, ...(job.animationRevision || job.stages.some(stage => stage.name === "base" && stage.status === "completed") ? {baseUrl: toPublicUrl(`/api/pet-generations/${job.id}/base`)} : {})} : {}),
    ...(job.reviewBase && job.baseConfirmedAt !== undefined && job.animationPrompt ? {animationPrompt: job.animationPrompt} : {}),
    canReviseAnimations: job.status === "completed" && !isUnacceptedAnimationRevision(job) && Boolean(job.animationRevision || job.stages.some(stage => stage.name === "base" && stage.status === "completed")),
    ...(job.animationRevision ? {animationRevision: {sourceGenerationId: job.animationRevision.sourceGenerationId, selectedStates: job.animationRevision.selectedStates, corrections: job.animationRevision.corrections, acceptedAt: job.animationRevision.acceptedAt, beforeSpritesheetUrl: toPublicUrl(`/api/pet-generations/${job.id}/animation-revision/source`)}} : {}),
    ...(metadata?{metadata}:{}),
    ...(job.status === "failed" || job.error ? { error: publicGenerationError(job.error ?? "generation_unavailable", job.providerFailure) } : {}),
    ...(job.status === "completed" ? { pet: { displayName: job.displayName, spriteVersionNumber: 2 as const, petJsonUrl: toPublicUrl(root + "pet.json"), spritesheetUrl: toPublicUrl(root + "spritesheet.webp"), zipUrl: isUnacceptedAnimationRevision(job) ? undefined : toPublicUrl(root + "pet.zip") } } : {}),
  };
}
