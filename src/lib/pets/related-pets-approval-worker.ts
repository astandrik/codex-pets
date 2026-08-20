import type {
  ApprovalPreparation,
  ApprovalRankingInputScope,
} from "@/lib/pets/approval-preparations-repository";

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
  cleanupGenerations: (input: {
    expectedGenerationId: string;
  }) => Promise<boolean>;
  cleanupInactiveGeneration: (input: {
    expectedGenerationId: string;
  }) => Promise<boolean>;
  onSucceeded: () => Promise<void>;
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
      generationId = dependencies.createGenerationId();
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
      await notifySucceeded();
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
      if (result === "succeeded") await notifySucceeded();
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

  async function notifySucceeded(): Promise<void> {
    try {
      await dependencies.onSucceeded();
    } catch {
      // Cache invalidation must not overwrite a committed approval outcome.
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
