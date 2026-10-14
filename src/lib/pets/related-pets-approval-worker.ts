import { petModerationPaused } from "@/lib/pets/moderation-pause";
import { prepareOpenAIApprovalMetadata } from "@/lib/pets/metadata-worker/approval";
import { isOpenAIPetsProfile } from "@/lib/pets/openai-embedding-profile";
import { randomUUID } from "node:crypto";

import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import type {
  ApprovalPreparation,
  ApprovalPreparationFinalizeResult,
  ApprovalRankingInputScope,
} from "@/lib/pets/approval-preparations-repository";
import {
  claimNextApprovalPreparation,
  getApprovalPreparation,
  createApprovalReviewId,
  finalizeApprovalPreparation,
  markApprovalPreparationFailure,
} from "@/lib/pets/approval-preparations-repository";
import { refreshPetRelatedAnnotation } from "@/lib/pets/related-pets-annotation-runtime";
import { refreshApprovedPetRelatedDescriptionEmbeddingsStrict } from "@/lib/pets/related-pets-query-runtime";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-profile";
import { prepareRelatedPetsGeneration } from "@/lib/pets/related-pets-rebuild";
import {
  cleanupInactiveRelatedPetsGeneration,
  cleanupRelatedPetsGenerations,
} from "@/lib/pets/related-pets-repository";
import { getPetForApprovalPreparationById } from "@/lib/pets/repository";
import type { PublicPet } from "@/lib/pets/types";
import { refreshApprovedPetSearchEmbedding } from "@/lib/pets/search-runtime";
import { refreshApprovedPetVisionSearch } from "@/lib/pets/search-vision-runtime";

type PreparedPet = {
  id: string;
  slug: string;
  status: string;
  updatedAt: string;
};

type ApprovalWorkerResult =
  | "idle"
  | "in_progress"
  | "succeeded"
  | "retry"
  | "manual_review";

type WorkerDependencies<Pet extends PreparedPet> = {
  rankingRevision: string;
  claim: (input: {
    workerId: string;
    now: string;
    leaseUntil: string;
  }) => Promise<ApprovalPreparation | null>;
  getPet: (petId: string) => Promise<Pet | null>;
  prepareSignals: (pet: Pet & { status: "approved" }, context: { preparation: ApprovalPreparation; workerId: string }) => Promise<void>;
  buildGeneration: (input: {
    generationId: string;
    pet: Pet & { status: "approved" };
  }) => Promise<{
    inputScope: ApprovalRankingInputScope;
    expectedInputRevision: string;
    expectedSnapshotCount: number;
  }>;
  finalize: (input: {
    preparationId: string;
    workerId: string;
    preparedGenerationId: string;
    reviewId: string;
    now: string;
    inputScope: ApprovalRankingInputScope;
    expectedInputRevision: string;
    expectedSnapshotCount: number;
  }) => Promise<ApprovalPreparationFinalizeResult>;
  markFailure: (input: {
    preparationId: string;
    workerId: string;
    failureCode: string;
    retryable: boolean;
    now: Date;
  }) => Promise<ApprovalPreparation | null>;
  cleanupGenerations: (input: {
    expectedGenerationId: string;
  }) => Promise<boolean>;
  cleanupInactiveGeneration: (input: {
    expectedGenerationId: string;
  }) => Promise<boolean>;
  onSucceeded: (petSlug: string) => Promise<void>;
  createGenerationId: () => string;
  createReviewId: () => string;
  now: () => Date;
};

const LEASE_MS = 30 * 60_000;
const RETRYABLE_FAILURES = new Set([
  "preparation_failed",
  "network_error",
  "timeout",
  "rate_limited",
  "overloaded",
  "provider_error",
  "provider_unavailable",
  "server_error",
  "generation_conflict",
  "generation_incomplete",
  "ranking_inputs_changed",
]);

export function createRelatedPetApprovalWorker<Pet extends PreparedPet>(
  dependencies: WorkerDependencies<Pet>,
) {
  return { runOnce };

  async function runOnce(
    workerId: string,
  ): Promise<ApprovalWorkerResult> {
    const startedAt = dependencies.now();
    const preparation = await dependencies.claim({
      workerId,
      now: startedAt.toISOString(),
      leaseUntil: new Date(startedAt.getTime() + LEASE_MS).toISOString(),
    });
    if (!preparation) return "idle";

    let generationId: string | null = null;
    let finalizationOutcomeUncertain = false;
    try {
      if (preparation.rankingRevision !== dependencies.rankingRevision) {
        throw preparationFailure("ranking_profile_changed");
      }
      const pet = await dependencies.getPet(preparation.petId);
      if (
        !pet ||
        pet.slug !== preparation.petSlug ||
        pet.status !== "pending" ||
        pet.updatedAt !== preparation.petUpdatedAt
      ) {
        throw preparationFailure("stale_submission");
      }
      const preparedPet = { ...pet, status: "approved" as const };
      await dependencies.prepareSignals(preparedPet, { preparation, workerId });
      generationId = dependencies.createGenerationId();
      const generation = await dependencies.buildGeneration({
        generationId,
        pet: preparedPet,
      });
      let finalization: ApprovalPreparationFinalizeResult;
      try {
        finalization = await dependencies.finalize({
          preparationId: preparation.preparationId,
          workerId,
          preparedGenerationId: generationId,
          reviewId: dependencies.createReviewId(),
          now: dependencies.now().toISOString(),
          ...generation,
        });
      } catch (error) {
        finalizationOutcomeUncertain = true;
        throw error;
      }
      if (finalization === "generation_conflict") {
        throw preparationFailure("generation_conflict");
      }
      if (finalization === "generation_incomplete") {
        throw preparationFailure("generation_incomplete");
      }
      if (finalization === "ranking_inputs_changed") {
        throw preparationFailure("ranking_inputs_changed");
      }
      if (finalization === "stale_inputs") {
        throw preparationFailure("stale_catalog");
      }
      await notifySucceeded(preparation.petSlug);
      return "succeeded";
    } catch (error) {
      const failureCode = failureCodeFrom(error);
      const updated = await dependencies.markFailure({
        preparationId: preparation.preparationId,
        workerId,
        failureCode,
        retryable: RETRYABLE_FAILURES.has(failureCode),
        now: dependencies.now(),
      });
      const result = resultFromPreparation(updated);
      if (result === "succeeded" && finalizationOutcomeUncertain) {
        await notifySucceeded(preparation.petSlug);
      }
      return result;
    } finally {
      if (generationId) await cleanupGeneration(generationId);
    }
  }

  async function cleanupGeneration(generationId: string): Promise<void> {
    try {
      if (await dependencies.cleanupGenerations({
        expectedGenerationId: generationId,
      })) return;
    } catch {
      // Cleanup must not overwrite the persisted approval outcome.
    }
    try {
      await dependencies.cleanupInactiveGeneration({
        expectedGenerationId: generationId,
      });
    } catch {
      // A later rebuild can retry cleanup of an unreferenced generation.
    }
  }

  async function notifySucceeded(petSlug: string): Promise<void> {
    try {
      await dependencies.onSucceeded(petSlug);
    } catch {
      // Publication hooks must not overwrite a committed approval outcome.
    }
  }
}

function resultFromPreparation(
  preparation: ApprovalPreparation | null,
): ApprovalWorkerResult {
  switch (preparation?.status) {
    case "succeeded":
      return "succeeded";
    case "retry":
      return "retry";
    case "queued":
    case "preparing":
      return "in_progress";
    default:
      return "manual_review";
  }
}

function preparationFailure(reason: string): Error & { reason: string } {
  return Object.assign(new Error(reason), { reason });
}

function failureCodeFrom(error: unknown): string {
  const reason = error && typeof error === "object" && "reason" in error
    ? String(error.reason)
    : "preparation_failed";
  return /^[a-z][a-z0-9_]{0,63}$/.test(reason)
    ? reason
    : "preparation_failed";
}

async function prepareProductionSignals(pet: PublicPet, context: { preparation: ApprovalPreparation; workerId: string }): Promise<void> {
  if (isOpenAIPetsProfile()) {
    await prepareOpenAIApprovalMetadata(pet, async () => {
      const current = await getApprovalPreparation(context.preparation.preparationId);
      const pending = await getPetForApprovalPreparationById(pet.id);
      const leaseUntil = Date.parse(current?.leaseUntil ?? "");
      // Provider timeout is three minutes. Never start a call near lease expiry.
      if (petModerationPaused() || !current || current.status !== "preparing" || current.leaseOwner !== context.workerId ||
          (!Number.isFinite(leaseUntil) || leaseUntil <= Date.now() + 240_000) || !pending || pending.status !== "pending" ||
          pending.updatedAt !== context.preparation.petUpdatedAt || pending.slug !== pet.slug) {
        throw preparationFailure("metadata_lease_or_input_changed");
      }
    });
  }
  const searchStatus = await refreshApprovedPetSearchEmbedding(pet);
  if (searchStatus === "skipped") {
    throw preparationFailure("embedding_configuration_missing");
  }
  const related = await refreshApprovedPetRelatedDescriptionEmbeddingsStrict(
    pet,
  );
  if (Object.values(related).some((status) => status === "skipped")) {
    throw preparationFailure("embedding_configuration_missing");
  }
  await refreshPetRelatedAnnotation(pet);
  const visual = await refreshApprovedPetVisionSearch(pet);
  if (visual === "skipped") {
    throw preparationFailure("visual_configuration_missing");
  }
}

const productionWorker = createRelatedPetApprovalWorker({
  rankingRevision: RELATED_PETS_V24_PROFILE.rankingRevision,
  claim: claimNextApprovalPreparation,
  getPet: getPetForApprovalPreparationById,
  prepareSignals: prepareProductionSignals,
  buildGeneration: async ({ generationId, pet }) => {
    const prepared = await prepareRelatedPetsGeneration({
      generationId,
      pendingPet: pet,
      includeVisual: true,
    });
    return {
      inputScope: prepared.inputScope,
      expectedInputRevision: prepared.expectedInputRevision,
      expectedSnapshotCount: prepared.coverage.snapshotCount,
    };
  },
  finalize: finalizeApprovalPreparation,
  markFailure: markApprovalPreparationFailure,
  cleanupGenerations: cleanupRelatedPetsGenerations,
  cleanupInactiveGeneration: cleanupInactiveRelatedPetsGeneration,
  onSucceeded: publishApprovedPet,
  createGenerationId: randomUUID,
  createReviewId: createApprovalReviewId,
  now: () => new Date(),
});

async function publishApprovedPet(petSlug: string): Promise<void> {
  const result = await notifyIndexNowOfApprovedPet(petSlug);
  if (result.status === "submitted") {
    console.info("[codex-pets][indexnow]", {
      slug: petSlug,
      status: "submitted",
      httpStatus: result.httpStatus,
      urlCount: result.urls.length,
    });
  } else if (result.status === "failed") {
    console.warn("[codex-pets][indexnow]", {
      slug: petSlug,
      status: "failed",
      httpStatus: result.httpStatus ?? null,
      urlCount: result.urls.length,
    });
  } else {
    console.info("[codex-pets][indexnow]", {
      slug: petSlug,
      status: "skipped",
      reason: result.reason,
    });
  }
}

export const runRelatedPetApprovalWorkerOnce = productionWorker.runOnce;
