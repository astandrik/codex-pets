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
    };
    expect(createApprovalPreparationId(input)).toBe(
      createApprovalPreparationId(input),
    );
    expect(createApprovalPreparationId({ ...input, petUpdatedAt: "changed" }))
      .not.toBe(createApprovalPreparationId(input));
    expect(createApprovalPreparationId({ ...input, rankingRevision: "changed" }))
      .not.toBe(createApprovalPreparationId(input));
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

  it("finalizes pet, review, generation and preparation in one transaction", async () => {
    const statements: string[] = [];
    const repository = createApprovalPreparationsRepository(fakeDependencies(
      statements,
      [1, 1, 9],
    ));

    await expect(repository.finalize(finalizeInput(9))).resolves.toBe(true);
    const atomicWrite = statements.at(-1) ?? "";
    expect(atomicWrite).toContain("UPDATE codex_pets");
    expect(atomicWrite).toContain("UPSERT INTO codex_pet_reviews");
    expect(atomicWrite).toContain("UPDATE codex_pet_related_state");
    expect(atomicWrite).toContain("UPDATE codex_pet_approval_preparations");
  });

  it.each([
    { counts: [0, 1, 9], label: "pending card" },
    { counts: [1, 0, 9], label: "active generation" },
    { counts: [1, 1, 8], label: "prepared generation" },
  ])("does not publish a stale or incomplete $label", async ({ counts }) => {
    const statements: string[] = [];
    const repository = createApprovalPreparationsRepository(
      fakeDependencies(statements, counts),
    );

    await expect(repository.finalize(finalizeInput(9))).resolves.toBe(false);
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

function fakeDependencies(statements: string[], counts: number[]) {
  const execute = async (statement: string) => {
    statements.push(statement);
    if (statement.includes("WHERE preparation_id = $preparation_id")) {
      return { resultSets: [{ rows: [{ items: [
        text("approval-1"),
        text("pet-1"),
        text("tallulah"),
        text("2026-08-11T00:00:00.000Z"),
        text("admin-1"),
        text("current-revision"),
        text("generation-active"),
        text(""),
        text("preparing"),
        uint(1),
        text("2026-08-11T00:00:00.000Z"),
        text("worker-1"),
        text("2026-08-11T00:10:00.000Z"),
        text(""),
        text("2026-08-11T00:00:00.000Z"),
        text("2026-08-11T00:00:00.000Z"),
      ] }] }] };
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

function text(value: string) {
  return { textValue: value };
}

function uint(value: number) {
  return { uint32Value: value };
}

function emptyInputRevision() {
  return JSON.stringify({ catalog: "[]", embeddings: "[]", captions: null });
}
