import { describe, expect, it } from "vitest";

import {
  createApprovalPreparationsRepository,
  createApprovalPreparationId,
  nextApprovalPreparationAttemptAt,
} from "@/lib/pets/approval-preparations-repository";

describe("approval preparation identity and retries", () => {
  it("uses the pending revision and ranking revision in its stable identity", () => {
    const input = {
      petId: "pet-1",
      petUpdatedAt: "2026-08-11T00:00:00.000Z",
      rankingRevision: "current-revision",
      expectedActiveGenerationId: "generation-active",
    };
    expect(createApprovalPreparationId(input)).toBe(
      createApprovalPreparationId(input),
    );
    expect(createApprovalPreparationId({ ...input, petUpdatedAt: "changed" }))
      .not.toBe(createApprovalPreparationId(input));
    expect(createApprovalPreparationId({ ...input, rankingRevision: "changed" }))
      .not.toBe(createApprovalPreparationId(input));
    const nextGeneration = {
      ...input,
      expectedActiveGenerationId: "generation-next",
    };
    expect(createApprovalPreparationId(nextGeneration)).toBe(
      createApprovalPreparationId(input),
    );
  });

  it("implements the bounded 1m, 5m, 30m, 2h, 6h schedule", () => {
    const now = new Date("2026-08-11T00:00:00.000Z");
    expect([1, 2, 3, 4, 5, 6].map((attempt) =>
      nextApprovalPreparationAttemptAt(attempt, now)
    )).toEqual([
      "2026-08-11T00:01:00.000Z",
      "2026-08-11T00:05:00.000Z",
      "2026-08-11T00:30:00.000Z",
      "2026-08-11T02:00:00.000Z",
      "2026-08-11T06:00:00.000Z",
      null,
    ]);
  });

  it("requeues an unchanged manual-review preparation transactionally", async () => {
    let requeued = false;
    const execute = async (
      statement: string,
      parameters: Record<string, unknown> = {},
    ) => {
      if (
        statement.includes("status = $queued") &&
        statement.includes("attempts = $zero")
      ) {
        requeued = true;
        expect(statement).toContain("attempts = $zero");
        expect(statement).toContain("prepared_generation_id = $empty");
        expect(statement).toContain("failure_code = $empty");
        expect(statement).toContain("AND status = $manual_review");
        expect(parameters.$active_generation_id).toBe("generation-next");
        return { resultSets: [] };
      }
      if (statement.includes("WHERE preparation_id = $preparation_id")) {
        return preparationResult({
          status: requeued ? "queued" : "manual_review",
          attempts: requeued ? 0 : 6,
          expectedActiveGenerationId: requeued
            ? "generation-next"
            : "generation-active",
        });
      }
      return { resultSets: [] };
    };
    const repository = createApprovalPreparationsRepository({
      isConfigured: () => true,
      values: {
        utf8: (value: string) => value,
        uint32: (value: number) => value,
      },
      execute,
      transaction: async <T>(operation: (actual: typeof execute) => Promise<T>) =>
        operation(execute),
    });

    await expect(repository.enqueue({
      petId: "pet-1",
      petSlug: "tallulah",
      petUpdatedAt: "2026-08-11T00:00:00.000Z",
      reviewerId: "admin-1",
      rankingRevision: "current-revision",
      expectedActiveGenerationId: "generation-next",
      now: "2026-08-11T00:10:00.000Z",
    })).resolves.toMatchObject({
      status: "queued",
      attempts: 0,
      failureCode: "",
      preparedGenerationId: "",
      expectedActiveGenerationId: "generation-next",
    });
    expect(requeued).toBe(true);
  });

  it.each(["queued", "preparing", "retry", "succeeded"] as const)(
    "keeps an existing %s preparation idempotent",
    async (status) => {
      const statements: string[] = [];
      const execute = async (statement: string) => {
        statements.push(statement);
        if (statement.includes("WHERE preparation_id = $preparation_id")) {
          return preparationResult({ status, attempts: 2 });
        }
        return { resultSets: [] };
      };
      const repository = createApprovalPreparationsRepository({
        isConfigured: () => true,
        values: {
          utf8: (value: string) => value,
          uint32: (value: number) => value,
        },
        execute,
        transaction: async <T>(
          operation: (actual: typeof execute) => Promise<T>,
        ) => operation(execute),
      });

      await expect(repository.enqueue({
        petId: "pet-1",
        petSlug: "tallulah",
        petUpdatedAt: "2026-08-11T00:00:00.000Z",
        reviewerId: "admin-1",
        rankingRevision: "current-revision",
        expectedActiveGenerationId: "generation-active",
        now: "2026-08-11T00:10:00.000Z",
      })).resolves.toMatchObject({ status, attempts: 2 });
      expect(statements.some((statement) =>
        statement.includes("status = $queued") &&
        statement.includes("attempts = $zero")
      )).toBe(false);
    },
  );

  it("increments Uint32 attempts with a typed parameter when claiming", async () => {
    let updated = false;
    const execute = async (
      statement: string,
      parameters: Record<string, unknown> = {},
    ) => {
      if (statement.includes("ORDER BY next_attempt_at")) {
        return preparationResult({ status: "queued", attempts: 0 });
      }
      if (statement.includes("FROM codex_pet_related_state")) {
        return { resultSets: [{ rows: [{ items: [
          text("ready"),
          text("generation-active"),
        ] }] }] };
      }
      if (statement.includes("SET status = $preparing")) {
        expect(statement).toContain("DECLARE $one AS Uint32");
        expect(parameters.$one).toBe(1);
        updated = true;
        return { resultSets: [] };
      }
      if (statement.includes("WHERE preparation_id = $preparation_id")) {
        return preparationResult({
          status: updated ? "preparing" : "queued",
          attempts: updated ? 1 : 0,
          leaseOwner: updated ? "worker-1" : "",
        });
      }
      return { resultSets: [] };
    };
    const repository = createApprovalPreparationsRepository({
      isConfigured: () => true,
      values: {
        utf8: (value: string) => value,
        uint32: (value: number) => value,
      },
      execute,
      transaction: async <T>(operation: (actual: typeof execute) => Promise<T>) =>
        operation(execute),
    });

    await expect(repository.claimNext({
      workerId: "worker-1",
      now: "2026-08-11T00:00:00.000Z",
      leaseUntil: "2026-08-11T00:30:00.000Z",
    })).resolves.toMatchObject({
      status: "preparing",
      attempts: 1,
      leaseOwner: "worker-1",
    });
  });

  it("rebases the expected generation while claiming", async () => {
    let updated = false;
    const execute = async (
      statement: string,
      parameters: Record<string, unknown> = {},
    ) => {
      if (statement.includes("ORDER BY next_attempt_at")) {
        return preparationResult({ status: "queued", attempts: 0 });
      }
      if (statement.includes("FROM codex_pet_related_state")) {
        return { resultSets: [{ rows: [{ items: [
          text("ready"),
          text("generation-current"),
        ] }] }] };
      }
      if (statement.includes("SET status = $preparing")) {
        expect(statement).toContain(
          "expected_active_generation_id = $active_generation_id",
        );
        expect(parameters.$active_generation_id).toBe("generation-current");
        updated = true;
        return { resultSets: [] };
      }
      if (statement.includes("WHERE preparation_id = $preparation_id")) {
        return preparationResult({
          status: updated ? "preparing" : "queued",
          attempts: updated ? 1 : 0,
          leaseOwner: updated ? "worker-1" : "",
          expectedActiveGenerationId: updated
            ? "generation-current"
            : "generation-active",
        });
      }
      return { resultSets: [] };
    };
    const repository = createApprovalPreparationsRepository({
      isConfigured: () => true,
      values: {
        utf8: (value: string) => value,
        uint32: (value: number) => value,
      },
      execute,
      transaction: async <T>(operation: (actual: typeof execute) => Promise<T>) =>
        operation(execute),
    });

    await expect(repository.claimNext({
      workerId: "worker-1",
      now: "2026-08-11T00:00:00.000Z",
      leaseUntil: "2026-08-11T00:30:00.000Z",
    })).resolves.toMatchObject({
      status: "preparing",
      expectedActiveGenerationId: "generation-current",
    });
  });

  it("finalizes pet, review, generation and preparation in one transaction", async () => {
    const statements: string[] = [];
    const parameters: Array<Record<string, unknown>> = [];
    const repository = createApprovalPreparationsRepository(fakeDependencies(
      statements,
      [1, 1, 9],
      parameters,
    ));

    await expect(repository.finalize(finalizeInput(9))).resolves.toBe(
      "succeeded",
    );
    const atomicWrite = statements.at(-1) ?? "";
    expect(atomicWrite).toContain("UPDATE codex_pets");
    expect(atomicWrite).toContain("UPSERT INTO codex_pet_reviews");
    expect(atomicWrite).toContain("UPDATE codex_pet_related_state");
    expect(atomicWrite).toContain("UPDATE codex_pet_approval_preparations");
    expect(parameters.some((entry) => entry.$state_id === "active")).toBe(true);
    expect(parameters.some((entry) => entry.$state_id === "global")).toBe(false);
  });

  it.each([
    { counts: [0, 1, 9], label: "pending card", outcome: "stale_inputs" },
    {
      counts: [1, 0, 9],
      label: "active generation",
      outcome: "generation_conflict",
    },
    { counts: [1, 1, 8], label: "prepared generation", outcome: "stale_inputs" },
  ])("does not publish a stale or incomplete $label", async ({
    counts,
    outcome,
  }) => {
    const statements: string[] = [];
    const repository = createApprovalPreparationsRepository(
      fakeDependencies(statements, counts),
    );

    await expect(repository.finalize(finalizeInput(9))).resolves.toBe(outcome);
    expect(statements.some((statement) =>
      statement.includes("UPSERT INTO codex_pet_reviews")
    )).toBe(false);
  });
});

function finalizeInput(expectedSnapshotCount: number) {
  return {
    preparationId: "approval-1",
    workerId: "worker-1",
    preparedGenerationId: "generation-current",
    reviewId: "review-1",
    now: "2026-08-11T00:01:00.000Z",
    inputScope: { embeddingModelRevisions: [], captionRevision: null },
    expectedInputRevision: emptyInputRevision(),
    expectedSnapshotCount,
  };
}

function fakeDependencies(
  statements: string[],
  counts: number[],
  parameters: Array<Record<string, unknown>> = [],
) {
  const execute = async (
    statement: string,
    actualParameters: Record<string, unknown> = {},
  ) => {
    statements.push(statement);
    parameters.push(actualParameters);
    if (statement.includes("WHERE preparation_id = $preparation_id")) {
      return preparationResult({
        status: "preparing",
        attempts: 1,
        leaseOwner: "worker-1",
      });
    }
    if (statement.includes("SELECT COUNT(*) AS pet_count")) {
      return {
        resultSets: counts.map((count) => ({ rows: [{ items: [uint(count)] }] })),
      };
    }
    return { resultSets: [] };
  };
  return {
    isConfigured: () => true,
    values: { utf8: (value: string) => value, uint32: (value: number) => value },
    execute,
    transaction: async <T>(operation: (actual: typeof execute) => Promise<T>) =>
      operation(execute),
  };
}

function preparationResult({
  status,
  attempts,
  leaseOwner = "",
  expectedActiveGenerationId = "generation-active",
}: {
  status: "queued" | "preparing" | "retry" | "manual_review" | "succeeded";
  attempts: number;
  leaseOwner?: string;
  expectedActiveGenerationId?: string;
}) {
  return { resultSets: [{ rows: [{ items: [
    text("approval-1"),
    text("pet-1"),
    text("tallulah"),
    text("2026-08-11T00:00:00.000Z"),
    text("admin-1"),
    text("current-revision"),
    text(expectedActiveGenerationId),
    text(""),
    text(status),
    uint(attempts),
    text("2026-08-11T00:00:00.000Z"),
    text(leaseOwner),
    text("2026-08-11T00:30:00.000Z"),
    text(""),
    text("2026-08-11T00:00:00.000Z"),
    text("2026-08-11T00:00:00.000Z"),
  ] }] }] };
}

function text(value: string) {
  return { textValue: value };
}

function uint(value: number) {
  return { uint32Value: value };
}

function emptyInputRevision() {
  return JSON.stringify({ catalog: "[]", embeddings: "[]", captions: null });
}
