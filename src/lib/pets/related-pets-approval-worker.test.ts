import { describe, expect, it, vi } from "vitest";

import { createRelatedPetApprovalWorker } from "@/lib/pets/related-pets-approval-worker";
import type { ApprovalPreparation } from "@/lib/pets/approval-preparations-repository";

const now = new Date("2026-08-11T00:00:00.000Z");
const preparation: ApprovalPreparation = {
  preparationId: "approval-1",
  petId: "pet-1",
  petSlug: "tallulah",
  petUpdatedAt: now.toISOString(),
  reviewerId: "admin-1",
  rankingRevision: "current-revision",
  expectedActiveGenerationId: "generation-active",
  preparedGenerationId: "",
  status: "preparing",
  attempts: 1,
  nextAttemptAt: now.toISOString(),
  leaseOwner: "worker-1",
  leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
  failureCode: "",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const pet = {
  id: "pet-1",
  slug: "tallulah",
  status: "pending",
  updatedAt: now.toISOString(),
};
const generation = {
  inputScope: { embeddingModelRevisions: [], captionRevision: null },
  expectedInputRevision: JSON.stringify({
    catalog: "[]",
    embeddings: "[]",
    captions: null,
  }),
  expectedSnapshotCount: 156,
};

describe("related pet approval worker", () => {
  it("publishes only after every signal and inactive generation are ready", async () => {
    const order: string[] = [];
    const worker = createRelatedPetApprovalWorker(dependencies({
      prepareSignals: async () => { order.push("signals"); },
      buildGeneration: async () => { order.push("generation"); return generation; },
      finalize: async () => { order.push("finalize"); return true; },
    }));

    await expect(worker.runOnce("worker-1")).resolves.toBe("succeeded");
    expect(order).toEqual(["signals", "generation", "finalize"]);
  });

  it("uses a thirty minute lease", async () => {
    const claim = vi.fn(async () => preparation);
    const worker = createRelatedPetApprovalWorker(dependencies({ claim }));

    await worker.runOnce("worker-1");

    expect(claim).toHaveBeenCalledWith({
      workerId: "worker-1",
      now: now.toISOString(),
      leaseUntil: new Date(now.getTime() + 30 * 60_000).toISOString(),
    });
  });

  it("keeps the pet pending and schedules transient failures", async () => {
    const finalize = vi.fn();
    const markFailure = vi.fn(async (input: { failureCode: string }) => ({
      ...preparation,
      status: "retry" as const,
      failureCode: input.failureCode,
    }));
    const worker = createRelatedPetApprovalWorker(dependencies({
      prepareSignals: async () => {
        throw Object.assign(new Error("private provider response"), {
          reason: "rate_limited",
        });
      },
      finalize,
      markFailure,
    }));

    await expect(worker.runOnce("worker-1")).resolves.toBe("retry");
    expect(finalize).not.toHaveBeenCalled();
    expect(markFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "rate_limited",
      retryable: true,
    }));
  });

  it("routes a changed pending submission to manual review", async () => {
    const prepareSignals = vi.fn();
    const markFailure = vi.fn(async (input: { failureCode: string }) => ({
      ...preparation,
      status: "manual_review" as const,
      failureCode: input.failureCode,
    }));
    const worker = createRelatedPetApprovalWorker(dependencies({
      getPet: async () => ({ ...pet, updatedAt: "changed" }),
      prepareSignals,
      markFailure,
    }));

    await expect(worker.runOnce("worker-1")).resolves.toBe("manual_review");
    expect(prepareSignals).not.toHaveBeenCalled();
    expect(markFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "stale_submission",
      retryable: false,
    }));
  });

  it("allows only one worker to claim a preparation", async () => {
    let claimed = false;
    const prepareSignals = vi.fn(async () => undefined);
    const shared = dependencies({
      claim: async () => {
        if (claimed) return null;
        claimed = true;
        return preparation;
      },
      prepareSignals,
    });

    await expect(Promise.all([
      createRelatedPetApprovalWorker(shared).runOnce("worker-1"),
      createRelatedPetApprovalWorker(shared).runOnce("worker-2"),
    ])).resolves.toEqual(expect.arrayContaining(["succeeded", "idle"]));
    expect(prepareSignals).toHaveBeenCalledOnce();
  });
});

function dependencies(
  overrides: Partial<Parameters<typeof createRelatedPetApprovalWorker>[0]> = {},
): Parameters<typeof createRelatedPetApprovalWorker>[0] {
  return {
    claim: async () => preparation,
    getPet: async () => pet,
    prepareSignals: async () => undefined,
    buildGeneration: async () => generation,
    finalize: async () => true,
    markFailure: async () => null,
    createGenerationId: () => "generation-current",
    createReviewId: () => "review-1",
    now: () => now,
    ...overrides,
  };
}
