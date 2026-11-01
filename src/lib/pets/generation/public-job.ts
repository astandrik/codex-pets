import {continuationEnabled} from "@/lib/pets/generation/continuation-model";
import {WAIT_MS, requiredStageNames, usesStageCheckpoints, isUnacceptedAnimationRevision, type GenerationJob} from "@/lib/pets/generation/model";
import type {PublicCardMetadata} from "@/lib/pets/generation/card-metadata";
import {publicGenerationError} from "@/lib/pets/generation/public-error";
import {toPublicUrl} from "@/lib/base-path";
import {getAnimationRepairSummary, canResumeAnimationRepair, hasUnsettledAnimationAttempt} from "@/lib/pets/generation/animation-repair";

export function publicJob(record: GenerationJob, now: number, metadata?:PublicCardMetadata) {
  let job = record;
  if (record.status === "queued" && (record.queuedAt ?? record.createdAt) + WAIT_MS <= now) {
    job = { ...record, status: "failed", error: "queue_timeout", prompt: "" };
  }
  if (record.status === "generating" && record.leaseUntil && record.leaseUntil <= now && !canResumeAnimationRepair(record) && (!usesStageCheckpoints(record) || record.stages.some(stage => stage.status === "inflight") || hasUnsettledAnimationAttempt(record))) {
    job = { ...record, status: "failed", error: "outcome_unknown" };
  }
  const root = `/api/pet-generations/${job.id}/files/`;
  let completedSteps=job.pipelineVersion===1&&job.status==="completed"?1:job.stages.filter(s=>s.status==="completed").length;
  let totalSteps=usesStageCheckpoints(job)?requiredStageNames(job).length:1;
  if(job.continuation){
    const planned=job.continuation.compositionStages;
    totalSteps=Math.max(1,planned.length);
    completedSteps=planned.length?job.stages.filter(s=>s.status==="completed"&&planned.some(n=>n===s.name)).length:job.status==="completed"?1:0;
  }
  return {
    generationId: job.id,
    status: job.status,
    progress: {completedSteps,totalSteps},
    ...(job.animationRepair ? {animationRepair: getAnimationRepairSummary(job, now)} : {}),
    expiresAt: new Date(job.expiresAt).toISOString(),
    pollAfterSeconds: job.status === "queued" || job.status === "generating" || job.status === "processing" ? 5 : undefined,
    previewUrl: toPublicUrl(`/generated/${job.id}`),
    submission: job.submission,
    ...(job.reviewBase ? {reviewBase: true, baseConfirmed: job.baseConfirmedAt !== undefined, ...(job.continuation || job.animationRevision || job.stages.some(stage => stage.name === "base" && stage.status === "completed") ? {baseUrl: toPublicUrl(`/api/pet-generations/${job.id}/base`)} : {})} : {}),
    ...(job.reviewBase && job.baseConfirmedAt !== undefined && job.animationPrompt ? {animationPrompt: job.animationPrompt} : {}),
    canContinue: continuationEnabled() && job.status==="failed" && job.reviewBase===true && job.baseConfirmedAt!==undefined && [2,3,4].includes(job.pipelineVersion),
    ...(job.continuation?{continuation:{sourceGenerationId:job.continuation.sourceGenerationId,mode:job.continuation.mode,regeneratedStates:job.continuation.generationStages}}:{}),
    ...(job.assemblyIssues?.length?{assemblyIssues:job.assemblyIssues}:{}),
    canReviseAnimations: job.status === "completed" && !isUnacceptedAnimationRevision(job) && Boolean(job.continuation || job.animationRevision || job.stages.some(stage => stage.name === "base" && stage.status === "completed")),
    ...(job.animationRevision ? {animationRevision: {sourceGenerationId: job.animationRevision.sourceGenerationId, selectedStates: job.animationRevision.selectedStates, corrections: job.animationRevision.corrections, acceptedAt: job.animationRevision.acceptedAt, beforeSpritesheetUrl: toPublicUrl(`/api/pet-generations/${job.id}/animation-revision/source`)}} : {}),
    ...(metadata?{metadata}:{}),
    ...(job.status === "failed" || job.error ? { error: publicGenerationError(job.error ?? "generation_unavailable", job.providerFailure) } : {}),
    ...(job.status === "completed" ? { pet: { displayName: job.displayName, spriteVersionNumber: 2 as const, petJsonUrl: toPublicUrl(root + "pet.json"), spritesheetUrl: toPublicUrl(root + "spritesheet.webp"), zipUrl: isUnacceptedAnimationRevision(job) ? undefined : toPublicUrl(root + "pet.zip") } } : {}),
  };
}
