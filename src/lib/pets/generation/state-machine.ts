import type { PetGenerationRunStatus, PetGenerationStage } from "@/lib/pets/generation/types";

const TRANSITIONS = {
  queued_base: ["generating_base", "cancelled"],
  generating_base: ["awaiting_base_review", "failed", "cancelled"],
  awaiting_base_review: ["queued_base", "queued_hatch", "cancelled"],
  queued_hatch: ["generating", "cancelled"],
  generating: ["validating", "failed", "cancelled"],
  validating: ["awaiting_final_review", "failed", "cancelled"],
  awaiting_final_review: ["submitting", "queued_hatch", "cancelled"],
  submitting: ["awaiting_moderation", "failed"],
  awaiting_moderation: ["completed", "submission_rejected"],
  completed: ["submission_rejected"],
  failed: ["queued_base", "queued_hatch", "cancelled"],
  cancelled: [],
  submission_rejected: [],
} as const satisfies Record<PetGenerationRunStatus, readonly PetGenerationRunStatus[]>;
export const TERMINAL_GENERATION_RUN_STATUSES = new Set<PetGenerationRunStatus>([
  "completed", "cancelled", "submission_rejected",
]);
export function canTransitionGenerationRun(from: PetGenerationRunStatus, to: PetGenerationRunStatus): boolean {
  return (TRANSITIONS[from] as readonly PetGenerationRunStatus[]).includes(to);
}
export function assertGenerationRunTransition(from: PetGenerationRunStatus, to: PetGenerationRunStatus): void {
  if (!canTransitionGenerationRun(from, to)) {
    throw new GenerationRunConflictError(`Cannot transition run from ${from} to ${to}.`);
  }
}
export function retryStatusForStage(stage: PetGenerationStage | null): "queued_base" | "queued_hatch" {
  return stage === "base" ? "queued_base" : "queued_hatch";
}
export class GenerationRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationRunConflictError";
  }
}
