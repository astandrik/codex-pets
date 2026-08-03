import { describe, expect, it } from "vitest";

import { createRelatedPetsRepository } from "@/lib/pets/related-pets-repository";

const values = {
  utf8: (value: string) => ({ textValue: value }),
  json: (value: string) => ({ textValue: value }),
};

type RecordedStatement = {
  statement: string;
  params: Record<string, unknown>;
  transactional: boolean;
};

function stateResult(input: {
  requested?: string | null;
  active?: string | null;
  previous?: string | null;
  status?: string;
  rankingRevision?: string;
  failureReason?: string | null;
  updatedAt?: string;
} = {}) {
  return {
    resultSets: [
      {
        rows: [
          {
            items: [
              { textValue: "active" },
              { textValue: input.requested ?? "" },
              { textValue: input.active ?? "" },
              { textValue: input.previous ?? "" },
              { textValue: input.status ?? "ready" },
              { textValue: input.rankingRevision ?? "ranking-v1" },
              { textValue: input.failureReason ?? "" },
              { textValue: input.updatedAt ?? "2026-08-03T10:00:00.000Z" },
            ],
          },
        ],
      },
    ],
  };
}

function createHarness(
  responder: (
    statement: string,
    params: Record<string, unknown>,
    transactional: boolean,
  ) => Promise<unknown> = async () => ({ resultSets: [] }),
) {
  const statements: RecordedStatement[] = [];
  let transactions = 0;
  const repository = createRelatedPetsRepository({
    isConfigured: () => true,
    values,
    execute: async (statement, params) => {
      statements.push({ statement, params, transactional: false });
      return responder(statement, params, false);
    },
    transaction: async (operation) => {
      transactions += 1;
      return operation(async (statement, params) => {
        statements.push({ statement, params, transactional: true });
        return responder(statement, params, true);
      });
    },
  });
  return { repository, statements, get transactions() { return transactions; } };
}

describe("related pets repository", () => {
  it("parses the singleton state and rejects unknown statuses", async () => {
    const valid = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-2",
            active: "generation-1",
            previous: "generation-0",
            status: "building",
            failureReason: null,
          })
        : { resultSets: [] },
    );

    await expect(valid.repository.getState()).resolves.toEqual({
      requestedGenerationId: "generation-2",
      activeGenerationId: "generation-1",
      previousGenerationId: "generation-0",
      status: "building",
      rankingRevision: "ranking-v1",
      failureReason: null,
      updatedAt: "2026-08-03T10:00:00.000Z",
    });

    const invalid = createHarness(async () =>
      stateResult({ status: "publishing" }),
    );
    await expect(invalid.repository.getState()).rejects.toThrow(
      "Invalid related pets state status.",
    );
  });

  it("parses snapshot arrays and rejects malformed JSON at the boundary", async () => {
    const valid = createHarness(async () => ({
      resultSets: [
        {
          rows: [
            {
              items: [
                { textValue: "generation-1" },
                { textValue: "source-pet" },
                { textValue: "ranking-v1" },
                { textValue: '["peer-a","peer-b"]' },
                { textValue: "2026-08-03T10:00:00.000Z" },
              ],
            },
          ],
        },
      ],
    }));

    await expect(
      valid.repository.getSnapshot("generation-1", "source-pet"),
    ).resolves.toEqual({
      generationId: "generation-1",
      sourceSlug: "source-pet",
      rankingRevision: "ranking-v1",
      relatedSlugs: ["peer-a", "peer-b"],
      createdAt: "2026-08-03T10:00:00.000Z",
    });

    const invalid = createHarness(async () => ({
      resultSets: [
        {
          rows: [
            {
              items: [
                { textValue: "generation-1" },
                { textValue: "source-pet" },
                { textValue: "ranking-v1" },
                { textValue: '{"slug":"peer-a"}' },
                { textValue: "2026-08-03T10:00:00.000Z" },
              ],
            },
          ],
        },
      ],
    }));
    await expect(
      invalid.repository.getSnapshot("generation-1", "source-pet"),
    ).rejects.toThrow("Invalid related pets snapshot slugs.");
  });

  it("starts a build and writes a validated inactive snapshot", async () => {
    const harness = createHarness();

    await harness.repository.requestBuild({
      generationId: "generation-2",
      rankingRevision: "ranking-v1",
      updatedAt: "2026-08-03T10:01:00.000Z",
    });
    await harness.repository.writeSnapshot({
      generationId: "generation-2",
      sourceSlug: "source-pet",
      rankingRevision: "ranking-v1",
      relatedSlugs: ["peer-a", "peer-b"],
      createdAt: "2026-08-03T10:02:00.000Z",
    });

    expect(harness.statements[0]?.statement).toContain(
      "UPSERT INTO codex_pet_related_state",
    );
    expect(harness.statements[0]?.statement).toContain(
      "requested_generation_id",
    );
    expect(harness.statements[0]?.params.$status).toEqual({
      textValue: "building",
    });
    expect(harness.statements[1]?.statement).toContain(
      "UPSERT INTO codex_pet_related_snapshots",
    );
    expect(harness.statements[1]?.params.$related_slugs_json).toEqual({
      textValue: '["peer-a","peer-b"]',
    });
    await expect(
      harness.repository.writeSnapshot({
        generationId: "generation-2",
        sourceSlug: "source-pet",
        rankingRevision: "ranking-v1",
        relatedSlugs: ["source-pet"],
        createdAt: "2026-08-03T10:02:00.000Z",
      }),
    ).rejects.toThrow("Invalid related pets snapshot slugs.");
  });

  it("conditionally activates only the requested generation", async () => {
    const current = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({ requested: "generation-2", active: "generation-1" })
        : { resultSets: [] },
    );

    await expect(
      current.repository.activateGeneration({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:03:00.000Z",
      }),
    ).resolves.toBe(true);
    expect(current.transactions).toBe(1);
    const update = current.statements.find(({ statement }) =>
      statement.includes("UPDATE codex_pet_related_state"),
    );
    expect(update?.transactional).toBe(true);
    expect(update?.statement).toContain(
      "requested_generation_id = $generation_id",
    );
    expect(update?.statement).toContain(
      "previous_generation_id = active_generation_id",
    );

    const superseded = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({ requested: "generation-3", active: "generation-1" })
        : { resultSets: [] },
    );
    await expect(
      superseded.repository.activateGeneration({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:03:00.000Z",
      }),
    ).resolves.toBe(false);
    expect(
      superseded.statements.some(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it("marks failure only while the generation is still requested", async () => {
    const current = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({ requested: "generation-2", status: "building" })
        : { resultSets: [] },
    );
    await expect(
      current.repository.markGenerationFailed({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        failureReason: "vector_validation_failed",
        updatedAt: "2026-08-03T10:04:00.000Z",
      }),
    ).resolves.toBe(true);
    expect(
      current.statements.find(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      )?.params.$failure_reason,
    ).toEqual({ textValue: "vector_validation_failed" });

    const superseded = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({ requested: "generation-3", status: "building" })
        : { resultSets: [] },
    );
    await expect(
      superseded.repository.markGenerationFailed({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        failureReason: "vector_validation_failed",
        updatedAt: "2026-08-03T10:04:00.000Z",
      }),
    ).resolves.toBe(false);
  });

  it("rejects unbounded failure messages before they can reach state", async () => {
    const harness = createHarness();

    await expect(
      harness.repository.markGenerationFailed({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        failureReason: "credential=secret vector=[1,2,3]",
        updatedAt: "2026-08-03T10:04:00.000Z",
      }),
    ).rejects.toThrow("Invalid related pets failure reason.");
    expect(harness.transactions).toBe(0);
  });

  it("cleans generations except the retained active and previous pair", async () => {
    const harness = createHarness();
    await harness.repository.cleanupGenerations({
      activeGenerationId: "generation-2",
      previousGenerationId: "generation-1",
    });

    expect(harness.statements[0]?.statement).toContain(
      "generation_id != $active_generation_id",
    );
    expect(harness.statements[0]?.statement).toContain(
      "generation_id != $previous_generation_id",
    );
    expect(harness.statements[0]?.params).toEqual({
      $active_generation_id: { textValue: "generation-2" },
      $previous_generation_id: { textValue: "generation-1" },
    });
  });

  it("atomically swaps the retained previous generation for recovery", async () => {
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT state_id")) {
        return stateResult({
          requested: "generation-2",
          active: "generation-2",
          previous: "generation-1",
        });
      }
      if (statement.includes("SELECT DISTINCT ranking_revision")) {
        return {
          resultSets: [
            { rows: [{ items: [{ textValue: "ranking-v0" }] }] },
          ],
        };
      }
      return { resultSets: [] };
    });

    await expect(
      harness.repository.recoverPreviousGeneration(
        "2026-08-03T10:05:00.000Z",
      ),
    ).resolves.toEqual({
      activeGenerationId: "generation-1",
      previousGenerationId: "generation-2",
      rankingRevision: "ranking-v0",
    });
    expect(harness.transactions).toBe(1);
    const update = harness.statements.find(({ statement }) =>
      statement.includes("UPDATE codex_pet_related_state"),
    );
    expect(update?.transactional).toBe(true);
    expect(update?.params).toMatchObject({
      $active_generation_id: { textValue: "generation-1" },
      $ranking_revision: { textValue: "ranking-v0" },
      $status: { textValue: "ready" },
    });
    expect(update?.statement).toContain(
      "previous_generation_id = active_generation_id",
    );
  });
});
