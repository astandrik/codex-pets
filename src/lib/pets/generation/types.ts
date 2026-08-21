import type { PetKind } from "@/lib/pets/types";

export const PET_GENERATION_RUN_STATUSES = [
  "queued_base", "generating_base", "awaiting_base_review", "queued_hatch",
  "generating", "validating", "awaiting_final_review", "submitting",
  "awaiting_moderation", "completed", "failed", "cancelled",
  "submission_rejected",
] as const;
export type PetGenerationRunStatus = (typeof PET_GENERATION_RUN_STATUSES)[number];

export const PET_GENERATION_STAGES = [
  "base", "idle", "running-right", "running-left", "waving", "jumping",
  "failed", "waiting", "running", "review", "cardinal", "look-row-9",
  "look-row-10", "assembly", "vision-review", "submission",
] as const;
export type PetGenerationStage = (typeof PET_GENERATION_STAGES)[number];
export type PetGenerationAttemptStatus = "leased" | "succeeded" | "failed" | "ambiguous";
export type PetGenerationReviewIssue = {
  row: number | null;
  frame: number | null;
  category: string;
  severity: "warning" | "error";
  message: string;
};
export type PetGenerationReview = { pass: boolean; issues: PetGenerationReviewIssue[] };
export type PetGenerationFinalMetadata = {
  id: string;
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
};
export type PetGenerationRun = {
  id: string;
  requestId: string;
  idempotencyKey: string;
  status: PetGenerationRunStatus;
  baseRevision: number;
  targetedRetryCount: number;
  imageCallCount: number;
  lastStage: PetGenerationStage | null;
  failureCode: string | null;
  failureMessage: string | null;
  review: PetGenerationReview | null;
  finalMetadata: PetGenerationFinalMetadata | null;
  finalPetId: string | null;
  finalPetSlug: string | null;
  approvedBy: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
};
export type PetGenerationArtifact = {
  runId: string;
  key: string;
  stage: PetGenerationStage;
  fileName: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  createdAt: string;
  expiresAt: string;
  retained: boolean;
};
export type PetGenerationStageAttempt = {
  runId: string;
  stage: PetGenerationStage;
  attempt: number;
  status: PetGenerationAttemptStatus;
  leaseOwner: string | null;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  heartbeatAt: string | null;
  requestHash: string;
  model: string;
  usageJson: string;
  providerRequestId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  ambiguous: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
};
