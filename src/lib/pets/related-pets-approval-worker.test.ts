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
    const workerDependencies = {
      ...dependencies({
        prepareSignals: async () => { order.push("signals"); },
        buildGeneration: async () => {
          order.push("generation");
          return generation;
        },
        finalize: async () => { order.push("finalize"); return "succeeded"; },
      }),
      onSucceeded: async (slug: string) => { order.push(`succeeded:${slug}`); },
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).resolves.toBe("succeeded");
    expect(order).toEqual([
      "signals",
      "generation",
      "finalize",
      "succeeded:tallulah",
    ]);
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

  it("leaves claim failures to the outer worker loop", async () => {
    const markFailure = vi.fn();
    const worker = createRelatedPetApprovalWorker(dependencies({
      claim: async () => {
        throw new Error("claim_failed");
      },
      markFailure,
    }));

    await expect(worker.runOnce("worker-1")).rejects.toThrow("claim_failed");
    expect(markFailure).not.toHaveBeenCalled();
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

  it("retries ordinary worker failures without a custom reason", async () => {
    const markFailure = vi.fn(async (input: { failureCode: string }) => ({
      ...preparation,
      status: "retry" as const,
      failureCode: input.failureCode,
    }));
    const worker = createRelatedPetApprovalWorker(dependencies({
      getPet: async () => {
        throw new Error("temporary storage outage");
      },
      markFailure,
    }));

    await expect(worker.runOnce("worker-1")).resolves.toBe("retry");
    expect(markFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "preparation_failed",
      retryable: true,
    }));
  });

  it("preserves a succeeded result returned by failure reconciliation", async () => {
    const onSucceeded = vi.fn(async () => undefined);
    const markFailure = vi.fn(async () => ({
      ...preparation,
      status: "succeeded" as const,
    }));
    const workerDependencies = {
      ...dependencies({
        finalize: async () => {
          throw new Error("finalize response lost");
        },
        markFailure,
      }),
      onSucceeded,
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).resolves.toBe("succeeded");
    expect(onSucceeded).toHaveBeenCalledWith("tallulah");
  });

  it("does not repeat another worker's publication after an earlier failure", async () => {
    const onSucceeded = vi.fn(async () => undefined);
    const worker = createRelatedPetApprovalWorker({
      ...dependencies({
        prepareSignals: async () => {
          throw new Error("temporary provider failure");
        },
        markFailure: async () => ({
          ...preparation,
          status: "succeeded" as const,
        }),
      }),
      onSucceeded,
    });

    await expect(worker.runOnce("worker-1")).resolves.toBe("succeeded");
    expect(onSucceeded).not.toHaveBeenCalled();
  });

  it("retries an active-generation conflict", async () => {
    const cleanupInactiveGeneration = vi.fn(async () => true);
    const markFailure = vi.fn(async (input: { failureCode: string }) => ({
      ...preparation,
      status: "retry" as const,
      failureCode: input.failureCode,
    }));
    const worker = createRelatedPetApprovalWorker({
      ...dependencies({
        finalize: async () => "generation_conflict",
        markFailure,
      }),
      cleanupGenerations: async () => false,
      cleanupInactiveGeneration,
    });

    await expect(worker.runOnce("worker-1")).resolves.toBe("retry");
    expect(markFailure).toHaveBeenCalledWith(expect.objectContaining({
      failureCode: "generation_conflict",
      retryable: true,
    }));
    expect(cleanupInactiveGeneration).toHaveBeenCalledWith({
      expectedGenerationId: "generation-current",
    });
  });

  it("does not run the success hook for a retry", async () => {
    const onSucceeded = vi.fn(async () => undefined);
    const workerDependencies = {
      ...dependencies({
        finalize: async () => {
          throw Object.assign(new Error("provider unavailable"), {
            reason: "provider_unavailable",
          });
        },
        markFailure: async () => ({ ...preparation, status: "retry" }),
      }),
      onSucceeded,
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).resolves.toBe("retry");
    expect(onSucceeded).not.toHaveBeenCalled();
  });

  it("does not let a success-hook error overwrite persisted success", async () => {
    const workerDependencies = {
      ...dependencies(),
      onSucceeded: async () => {
        throw new Error("cache invalidation unavailable");
      },
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).resolves.toBe("succeeded");
  });

  it("reports in_progress after another worker reclaims the preparation", async () => {
    const markFailure = vi.fn(async () => ({
      ...preparation,
      leaseOwner: "worker-2",
      status: "preparing" as const,
    }));
    const worker = createRelatedPetApprovalWorker(dependencies({
      finalize: async () => "stale_inputs",
      markFailure,
    }));

    await expect(worker.runOnce("worker-1")).resolves.toBe("in_progress");
  });

  it("cleans older generations after a successful finalization", async () => {
    const cleanupGenerations = vi.fn(async () => true);
    const cleanupInactiveGeneration = vi.fn(async () => true);
    const workerDependencies = {
      ...dependencies(),
      cleanupGenerations,
      cleanupInactiveGeneration,
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).resolves.toBe("succeeded");
    expect(cleanupGenerations).toHaveBeenCalledWith({
      expectedGenerationId: "generation-current",
    });
    expect(cleanupInactiveGeneration).not.toHaveBeenCalled();
  });

  it("cleans an inactive generation after failed finalization", async () => {
    const cleanupGenerations = vi.fn(async () => false);
    const cleanupInactiveGeneration = vi.fn(async () => true);
    const workerDependencies = {
      ...dependencies({ finalize: async () => "stale_inputs" }),
      cleanupGenerations,
      cleanupInactiveGeneration,
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).resolves.toBe("manual_review");
    expect(cleanupGenerations).toHaveBeenCalledWith({
      expectedGenerationId: "generation-current",
    });
    expect(cleanupInactiveGeneration).toHaveBeenCalledWith({
      expectedGenerationId: "generation-current",
    });
  });

  it("cleans a partially built generation without masking the worker result", async () => {
    const cleanupGenerations = vi.fn(async () => false);
    const cleanupInactiveGeneration = vi.fn(async () => true);
    const workerDependencies = {
      ...dependencies({
        buildGeneration: async () => {
          throw Object.assign(new Error("provider unavailable"), {
            reason: "provider_unavailable",
          });
        },
        markFailure: async () => ({ ...preparation, status: "retry" }),
      }),
      cleanupGenerations,
      cleanupInactiveGeneration,
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).resolves.toBe("retry");
    expect(cleanupInactiveGeneration).toHaveBeenCalledWith({
      expectedGenerationId: "generation-current",
    });
  });

  it("does not let cleanup failures overwrite a successful approval", async () => {
    const workerDependencies = {
      ...dependencies(),
      cleanupGenerations: async () => {
        throw new Error("cleanup unavailable");
      },
      cleanupInactiveGeneration: async () => {
        throw new Error("cleanup unavailable");
      },
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).resolves.toBe("succeeded");
  });

  it("does not let cleanup failures mask a failure-persistence error", async () => {
    const workerDependencies = {
      ...dependencies({
        finalize: async () => "stale_inputs",
        markFailure: async () => {
          throw new Error("failure persistence unavailable");
        },
      }),
      cleanupGenerations: async () => {
        throw new Error("cleanup unavailable");
      },
      cleanupInactiveGeneration: async () => {
        throw new Error("cleanup unavailable");
      },
    };
    const worker = createRelatedPetApprovalWorker(workerDependencies);

    await expect(worker.runOnce("worker-1")).rejects.toThrow(
      "failure persistence unavailable",
    );
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
    finalize: async () => "succeeded",
    markFailure: async () => null,
    cleanupGenerations: async () => true,
    cleanupInactiveGeneration: async () => true,
    onSucceeded: async () => undefined,
    createGenerationId: () => "generation-current",
    createReviewId: () => "review-1",
    now: () => now,
    ...overrides,
  };
}
