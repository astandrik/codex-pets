import { randomUUID } from "node:crypto";

import type {
  ApprovalPreparation,
  ApprovalRankingInputScope,
} from "@/lib/pets/approval-preparations-repository";
import {
  claimNextApprovalPreparation,
  createApprovalReviewId,
  finalizeApprovalPreparation,
  markApprovalPreparationFailure,
} from "@/lib/pets/approval-preparations-repository";
import { refreshPetRelatedAnnotation } from "@/lib/pets/related-pets-annotation-runtime";
import { refreshApprovedPetRelatedDescriptionEmbeddingsStrict } from "@/lib/pets/related-pets-query-runtime";
import { prepareRelatedPetsGeneration } from "@/lib/pets/related-pets-rebuild";
import {
  getPetForApprovalPreparationById,
  listApprovedPetsForSearch,
} from "@/lib/pets/repository";
import type { PublicPet } from "@/lib/pets/types";
import { refreshApprovedPetSearchEmbedding } from "@/lib/pets/search-runtime";
import { refreshApprovedPetVisionSearch } from "@/lib/pets/search-vision-runtime";

type PreparedPet = {
  id: string;
  slug: string;
  status: string;
  updatedAt: string;
};

type WorkerDependencies<Pet extends PreparedPet> = {
  claim: (input: {
    workerId: string;
    now: string;
    leaseUntil: string;
  }) => Promise<ApprovalPreparation | null>;
  getPet: (petId: string) => Promise<Pet | null>;
  prepareSignals: (pet: Pet & { status: "approved" }) => Promise<void>;
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
  }) => Promise<boolean>;
  markFailure: (input: {
    preparationId: string;
    workerId: string;
    failureCode: string;
    retryable: boolean;
    now: Date;
  }) => Promise<ApprovalPreparation | null>;
  createGenerationId: () => string;
  createReviewId: () => string;
  now: () => Date;
};

const LEASE_MS = 30 * 60_000;
const RETRYABLE_FAILURES = new Set([
  "network_error",
  "timeout",
  "rate_limited",
  "overloaded",
  "provider_error",
  "provider_unavailable",
  "server_error",
]);

export function createRelatedPetApprovalWorker<Pet extends PreparedPet>(
  dependencies: WorkerDependencies<Pet>,
) {
  return { runOnce };

  async function runOnce(
    workerId: string,
  ): Promise<"idle" | "succeeded" | "retry" | "manual_review"> {
    const startedAt = dependencies.now();
    const preparation = await dependencies.claim({
      workerId,
      now: startedAt.toISOString(),
      leaseUntil: new Date(startedAt.getTime() + LEASE_MS).toISOString(),
    });
    if (!preparation) return "idle";

    try {
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
      await dependencies.prepareSignals(preparedPet);
      const generationId = dependencies.createGenerationId();
      const generation = await dependencies.buildGeneration({
        generationId,
        pet: preparedPet,
      });
      const finalized = await dependencies.finalize({
        preparationId: preparation.preparationId,
        workerId,
        preparedGenerationId: generationId,
        reviewId: dependencies.createReviewId(),
        now: dependencies.now().toISOString(),
        ...generation,
      });
      if (!finalized) throw preparationFailure("stale_catalog");
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
      return updated?.status === "retry" ? "retry" : "manual_review";
    }
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

async function prepareProductionSignals(pet: PublicPet): Promise<void> {
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
  claim: claimNextApprovalPreparation,
  getPet: getPetForApprovalPreparationById,
  prepareSignals: prepareProductionSignals,
  buildGeneration: async ({ generationId, pet }) => {
    const approvedPets = await listApprovedPetsForSearch();
    const prepared = await prepareRelatedPetsGeneration({
      generationId,
      candidatePets: [...approvedPets, pet],
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
  createGenerationId: randomUUID,
  createReviewId: createApprovalReviewId,
  now: () => new Date(),
});

export const runRelatedPetApprovalWorkerOnce = productionWorker.runOnce;
