import { describe, expect, it } from "vitest";

import {
  createRelatedPetsRepository,
  type RelatedPetsState,
} from "@/lib/pets/related-pets-repository";

const values = {
  utf8: (value: string) => ({ textValue: value }),
  json: (value: string) => ({ textValue: value }),
};

const EMPTY_INPUT_SCOPE = {
  embeddingModelRevisions: [],
  captionRevision: null,
};
const EMPTY_INPUT_REVISION = JSON.stringify({
  catalog: "[]",
  embeddings: "[]",
  captions: null,
});
const PREVIOUS_READY_STATE: RelatedPetsState = {
  requestedGenerationId: "generation-1",
  activeGenerationId: "generation-1",
  previousGenerationId: "generation-0",
  status: "ready",
  rankingRevision: "ranking-v1",
  failureReason: null,
  updatedAt: "2026-08-03T09:59:00.000Z",
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

function catalogRevisionResult(updatedAt: string) {
  return {
    resultSets: [
      {
        rows: [
          {
            items: [
              { textValue: "source-pet" },
              { textValue: updatedAt },
            ],
          },
        ],
      },
    ],
  };
}

function embeddingRevisionResult(updatedAt: string) {
  return {
    resultSets: [
      {
        rows: [
          {
            items: [
              { textValue: "source-pet" },
              { textValue: "source-hash" },
              { uint32Value: 2 },
              { textValue: updatedAt },
            ],
          },
        ],
      },
    ],
  };
}

function captionRevisionResult(updatedAt: string) {
  return {
    resultSets: [
      {
        rows: [
          {
            items: [
              { textValue: "source-pet" },
              { textValue: "caption-source-hash" },
              { textValue: updatedAt },
            ],
          },
        ],
      },
    ],
  };
}

function generationRevisionResult(rankingRevision: string) {
  return {
    resultSets: [
      {
        rows: [{ items: [{ textValue: rankingRevision }] }],
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

  it("lists one generation of snapshots in a single ordered query", async () => {
    const harness = createHarness(async () => ({
      resultSets: [{
        rows: ["source-a", "source-b"].map((sourceSlug) => ({
          items: [
            { textValue: "generation-1" },
            { textValue: sourceSlug },
            { textValue: "ranking-v1" },
            { textValue: '["peer-a","peer-b"]' },
            { textValue: "2026-08-03T10:00:00.000Z" },
          ],
        })),
      }],
    }));

    await expect(
      harness.repository.listSnapshots("generation-1"),
    ).resolves.toHaveLength(2);
    expect(harness.statements).toHaveLength(1);
    expect(harness.statements[0]?.statement).toContain("ORDER BY source_slug");
    expect(harness.statements[0]?.params.$generation_id).toEqual({
      textValue: "generation-1",
    });
  });

  it("accepts eight snapshot slugs and rejects nine", async () => {
    const harness = createHarness();
    const baseSnapshot = {
      generationId: "generation-2",
      sourceSlug: "source-pet",
      rankingRevision: "ranking-v1",
      createdAt: "2026-08-03T10:02:00.000Z",
    };

    await expect(
      harness.repository.writeSnapshot({
        ...baseSnapshot,
        relatedSlugs: Array.from({ length: 8 }, (_, index) => `peer-${index}`),
      }),
    ).resolves.toBeUndefined();
    await expect(
      harness.repository.writeSnapshot({
        ...baseSnapshot,
        relatedSlugs: Array.from({ length: 9 }, (_, index) => `peer-${index}`),
      }),
    ).rejects.toThrow("Invalid related pets snapshot slugs.");
  });

  it("starts a build and writes a validated inactive snapshot", async () => {
    let state: Parameters<typeof stateResult>[0] | null = null;
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT state_id")) {
        return state ? stateResult(state) : { resultSets: [] };
      }
      if (statement.includes("UPSERT INTO codex_pet_related_state")) {
        state = {
          requested: "generation-2",
          status: "building",
          rankingRevision: "ranking-v1",
          updatedAt: "2026-08-03T10:01:00.000Z",
        };
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(EMPTY_INPUT_SCOPE);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }

    await expect(
      harness.repository.requestBuild({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:01:00.000Z",
        expectedState: null,
        inputScope: EMPTY_INPUT_SCOPE,
        expectedInputRevision,
      }),
    ).resolves.toBe(true);
    await harness.repository.writeSnapshot({
      generationId: "generation-2",
      sourceSlug: "source-pet",
      rankingRevision: "ranking-v1",
      relatedSlugs: ["peer-a", "peer-b"],
      createdAt: "2026-08-03T10:02:00.000Z",
    });

    const request = harness.statements.find(({ statement }) =>
      statement.includes("UPSERT INTO codex_pet_related_state"),
    );
    expect(request?.statement).toContain(
      "requested_generation_id",
    );
    expect(request?.params.$status).toEqual({
      textValue: "building",
    });
    const snapshotWrite = harness.statements.find(({ statement }) =>
      statement.includes("UPSERT INTO codex_pet_related_snapshots"),
    );
    expect(snapshotWrite?.params.$related_slugs_json).toEqual({
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

  it("does not replay an older build request over a newer generation", async () => {
    const capturedState = {
      requestedGenerationId: "generation-1",
      activeGenerationId: "generation-1",
      previousGenerationId: "generation-0",
      status: "ready" as const,
      rankingRevision: "ranking-v1",
      failureReason: null,
      updatedAt: "2026-08-03T10:00:00.000Z",
    };
    let state: RelatedPetsState = { ...capturedState };
    const harness = createHarness(async (statement, params) => {
      if (statement.includes("SELECT state_id")) {
        return stateResult({
          requested: state.requestedGenerationId,
          active: state.activeGenerationId,
          previous: state.previousGenerationId,
          status: state.status,
          rankingRevision: state.rankingRevision,
          failureReason: state.failureReason,
          updatedAt: state.updatedAt,
        });
      }
      if (statement.includes("UPDATE codex_pet_related_state")) {
        state = {
          ...state,
          requestedGenerationId: String(
            (params.$generation_id as { textValue: string }).textValue,
          ),
          status: "building",
          rankingRevision: String(
            (params.$ranking_revision as { textValue: string }).textValue,
          ),
          failureReason: null,
          updatedAt: String(
            (params.$updated_at as { textValue: string }).textValue,
          ),
        };
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(EMPTY_INPUT_SCOPE);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }
    const input = {
      generationId: "generation-2",
      rankingRevision: "ranking-v1",
      updatedAt: "2026-08-03T10:01:00.000Z",
      expectedState: capturedState,
      inputScope: EMPTY_INPUT_SCOPE,
      expectedInputRevision,
    };

    await expect(harness.repository.requestBuild(input)).resolves.toBe(true);
    await expect(harness.repository.requestBuild(input)).resolves.toBe(true);

    state = {
      ...state,
      requestedGenerationId: "generation-3",
      status: "building",
      updatedAt: "2026-08-03T10:02:00.000Z",
    };
    await expect(harness.repository.requestBuild(input)).resolves.toBe(false);

    expect(
      harness.statements.filter(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toHaveLength(1);
    expect(state.requestedGenerationId).toBe("generation-3");
  });

  it("accepts an identical committed build request after ranking inputs change", async () => {
    let catalogUpdatedAt = "2026-08-03T10:00:00.000Z";
    let state: RelatedPetsState = { ...PREVIOUS_READY_STATE };
    const harness = createHarness(async (statement, params) => {
      if (statement.includes("SELECT slug,")) {
        return catalogRevisionResult(catalogUpdatedAt);
      }
      if (statement.includes("SELECT state_id")) {
        return stateResult({
          requested: state.requestedGenerationId,
          active: state.activeGenerationId,
          previous: state.previousGenerationId,
          status: state.status,
          rankingRevision: state.rankingRevision,
          failureReason: state.failureReason,
          updatedAt: state.updatedAt,
        });
      }
      if (statement.includes("UPDATE codex_pet_related_state")) {
        state = {
          ...state,
          requestedGenerationId: String(
            (params.$generation_id as { textValue: string }).textValue,
          ),
          status: "building",
          rankingRevision: String(
            (params.$ranking_revision as { textValue: string }).textValue,
          ),
          failureReason: null,
          updatedAt: String(
            (params.$updated_at as { textValue: string }).textValue,
          ),
        };
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(EMPTY_INPUT_SCOPE);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }
    const input = {
      generationId: "generation-2",
      rankingRevision: "ranking-v1",
      updatedAt: "2026-08-03T10:01:00.000Z",
      expectedState: PREVIOUS_READY_STATE,
      inputScope: EMPTY_INPUT_SCOPE,
      expectedInputRevision,
    };

    await expect(harness.repository.requestBuild(input)).resolves.toBe(true);
    catalogUpdatedAt = "2026-08-03T10:02:00.000Z";
    await expect(harness.repository.requestBuild(input)).resolves.toBe(true);

    expect(
      harness.statements.filter(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toHaveLength(1);
  });

  it("rejects rankings captured before the approved catalog changed", async () => {
    let catalogUpdatedAt = "2026-08-03T10:00:00.000Z";
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT slug,")) {
        return catalogRevisionResult(catalogUpdatedAt);
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(EMPTY_INPUT_SCOPE);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }
    catalogUpdatedAt = "2026-08-03T10:01:00.000Z";

    await expect(
      harness.repository.requestBuild({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:02:00.000Z",
        expectedState: null,
        inputScope: EMPTY_INPUT_SCOPE,
        expectedInputRevision,
      }),
    ).resolves.toBe(false);

    const catalogReads = harness.statements.filter(({ statement }) =>
      statement.includes("SELECT slug,"),
    );
    expect(catalogReads).toHaveLength(2);
    expect(catalogReads[0]?.transactional).toBe(false);
    expect(catalogReads[1]?.transactional).toBe(true);
    expect(
      harness.statements.some(
        ({ statement }) =>
          statement.includes("UPDATE codex_pet_related_state") ||
          statement.includes("UPSERT INTO codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it("rejects rankings captured before an embedding row changed", async () => {
    let embeddingUpdatedAt = "2026-08-03T10:00:00.000Z";
    const inputScope = {
      embeddingModelRevisions: ["text-query-v1", "text-document-v1"],
      captionRevision: null,
    };
    const harness = createHarness(async (statement) => {
      if (statement.includes("FROM codex_pet_search_embeddings")) {
        return embeddingRevisionResult(embeddingUpdatedAt);
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(inputScope);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }
    embeddingUpdatedAt = "2026-08-03T10:01:00.000Z";

    await expect(
      harness.repository.requestBuild({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:02:00.000Z",
        expectedState: null,
        inputScope,
        expectedInputRevision,
      }),
    ).resolves.toBe(false);

    const embeddingReads = harness.statements.filter(({ statement }) =>
      statement.includes("FROM codex_pet_search_embeddings"),
    );
    expect(embeddingReads).toHaveLength(4);
    expect(embeddingReads.slice(0, 2).every((item) => !item.transactional)).toBe(
      true,
    );
    expect(embeddingReads.slice(2).every((item) => item.transactional)).toBe(
      true,
    );
    expect(
      harness.statements.some(
        ({ statement }) =>
          statement.includes("UPDATE codex_pet_related_state") ||
          statement.includes("UPSERT INTO codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it("rejects rankings captured before a visual caption changed", async () => {
    let captionUpdatedAt = "2026-08-03T10:00:00.000Z";
    const inputScope = {
      embeddingModelRevisions: [],
      captionRevision: "visual-caption-v1",
    };
    const harness = createHarness(async (statement) => {
      if (statement.includes("FROM codex_pet_search_captions")) {
        return captionRevisionResult(captionUpdatedAt);
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(inputScope);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }
    captionUpdatedAt = "2026-08-03T10:01:00.000Z";

    await expect(
      harness.repository.requestBuild({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:02:00.000Z",
        expectedState: null,
        inputScope,
        expectedInputRevision,
      }),
    ).resolves.toBe(false);

    const captionReads = harness.statements.filter(({ statement }) =>
      statement.includes("FROM codex_pet_search_captions"),
    );
    expect(captionReads).toHaveLength(2);
    expect(captionReads[0]?.transactional).toBe(false);
    expect(captionReads[1]?.transactional).toBe(true);
    expect(
      harness.statements.some(
        ({ statement }) =>
          statement.includes("UPDATE codex_pet_related_state") ||
          statement.includes("UPSERT INTO codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it("conditionally activates only the requested generation", async () => {
    const current = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-2",
            active: "generation-1",
            status: "building",
          })
        : { resultSets: [] },
    );

    await expect(
      current.repository.activateGeneration({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:03:00.000Z",
        inputScope: EMPTY_INPUT_SCOPE,
        expectedInputRevision: EMPTY_INPUT_REVISION,
        previousState: null,
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
        inputScope: EMPTY_INPUT_SCOPE,
        expectedInputRevision: EMPTY_INPUT_REVISION,
        previousState: null,
      }),
    ).resolves.toBe(false);
    expect(
      superseded.statements.some(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it("rejects activation after a ranking input changed", async () => {
    let catalogUpdatedAt = "2026-08-03T10:00:00.000Z";
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT slug,")) {
        return catalogRevisionResult(catalogUpdatedAt);
      }
      if (statement.includes("SELECT state_id")) {
        return stateResult({
          requested: "generation-2",
          active: "generation-1",
          status: "building",
        });
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(EMPTY_INPUT_SCOPE);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }
    catalogUpdatedAt = "2026-08-03T10:01:00.000Z";

    await expect(
      harness.repository.activateGeneration({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:02:00.000Z",
        inputScope: EMPTY_INPUT_SCOPE,
        expectedInputRevision,
        previousState: PREVIOUS_READY_STATE,
      }),
    ).resolves.toBe(false);

    const restore = harness.statements.find(({ statement }) =>
      statement.includes(
        "SET requested_generation_id = $previous_requested_generation_id",
      ),
    );
    expect(restore?.transactional).toBe(true);
    expect(restore?.params).toMatchObject({
      $previous_requested_generation_id: { textValue: "generation-1" },
      $previous_active_generation_id: { textValue: "generation-1" },
      $previous_generation_id: { textValue: "generation-0" },
      $previous_status: { textValue: "ready" },
      $previous_ranking_revision: { textValue: "ranking-v1" },
    });
  });

  it("restores the last ready generation instead of an abandoned building generation", async () => {
    let catalogUpdatedAt = "2026-08-03T10:00:00.000Z";
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT slug,")) {
        return catalogRevisionResult(catalogUpdatedAt);
      }
      if (statement.includes("SELECT state_id")) {
        return stateResult({
          requested: "generation-3",
          active: "generation-1",
          previous: "generation-0",
          status: "building",
          rankingRevision: "ranking-v2",
        });
      }
      if (statement.includes("SELECT DISTINCT ranking_revision")) {
        return generationRevisionResult("ranking-v1");
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(EMPTY_INPUT_SCOPE);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }
    catalogUpdatedAt = "2026-08-03T10:01:00.000Z";

    await expect(
      harness.repository.activateGeneration({
        generationId: "generation-3",
        rankingRevision: "ranking-v2",
        updatedAt: "2026-08-03T10:02:00.000Z",
        inputScope: EMPTY_INPUT_SCOPE,
        expectedInputRevision,
        previousState: {
          requestedGenerationId: "generation-2",
          activeGenerationId: "generation-1",
          previousGenerationId: "generation-0",
          status: "building",
          rankingRevision: "ranking-v2",
          failureReason: null,
          updatedAt: "2026-08-03T10:00:30.000Z",
        },
      }),
    ).resolves.toBe(false);

    const restore = harness.statements.find(({ statement }) =>
      statement.includes(
        "SET requested_generation_id = $previous_requested_generation_id",
      ),
    );
    expect(restore?.params).toMatchObject({
      $previous_requested_generation_id: { textValue: "generation-1" },
      $previous_active_generation_id: { textValue: "generation-1" },
      $previous_generation_id: { textValue: "generation-0" },
      $previous_status: { textValue: "ready" },
      $previous_ranking_revision: { textValue: "ranking-v1" },
    });
  });

  it("retries activation without replacing or cleaning the retained previous generation", async () => {
    let state = {
      requested: "generation-2",
      active: "generation-1",
      previous: "generation-0",
      status: "building",
      rankingRevision: "ranking-v1",
    };
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT state_id")) {
        return stateResult(state);
      }
      if (statement.includes("UPDATE codex_pet_related_state")) {
        state = {
          requested: "generation-2",
          active: "generation-2",
          previous: "generation-1",
          status: "ready",
          rankingRevision: "ranking-v1",
        };
      }
      return { resultSets: [] };
    });
    const input = {
      generationId: "generation-2",
      rankingRevision: "ranking-v1",
      updatedAt: "2026-08-03T10:03:00.000Z",
      inputScope: EMPTY_INPUT_SCOPE,
      expectedInputRevision: EMPTY_INPUT_REVISION,
      previousState: null,
    };

    await expect(harness.repository.activateGeneration(input)).resolves.toBe(
      true,
    );
    await expect(harness.repository.activateGeneration(input)).resolves.toBe(
      true,
    );
    await expect(
      harness.repository.cleanupGenerations({
        expectedGenerationId: "generation-2",
      }),
    ).resolves.toBe(true);

    expect(
      harness.statements.filter(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toHaveLength(1);
    expect(
      harness.statements.find(({ statement }) =>
        statement.includes("DELETE FROM codex_pet_related_snapshots"),
      )?.params,
    ).toEqual({
      $active_generation_id: { textValue: "generation-2" },
      $previous_generation_id: { textValue: "generation-1" },
    });
  });

  it("accepts an identical committed activation after ranking inputs change", async () => {
    let catalogUpdatedAt = "2026-08-03T10:00:00.000Z";
    let state = {
      requested: "generation-2",
      active: "generation-1",
      previous: "generation-0",
      status: "building",
      rankingRevision: "ranking-v1",
    };
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT slug,")) {
        return catalogRevisionResult(catalogUpdatedAt);
      }
      if (statement.includes("SELECT state_id")) {
        return stateResult(state);
      }
      if (
        statement.includes("UPDATE codex_pet_related_state") &&
        statement.includes("previous_generation_id = active_generation_id")
      ) {
        state = {
          requested: "generation-2",
          active: "generation-2",
          previous: "generation-1",
          status: "ready",
          rankingRevision: "ranking-v1",
        };
      }
      return { resultSets: [] };
    });
    const expectedInputRevision =
      await harness.repository.getRankingInputRevision(EMPTY_INPUT_SCOPE);
    if (expectedInputRevision === null) {
      throw new Error("Expected configured ranking input revision.");
    }
    const input = {
      generationId: "generation-2",
      rankingRevision: "ranking-v1",
      updatedAt: "2026-08-03T10:03:00.000Z",
      inputScope: EMPTY_INPUT_SCOPE,
      expectedInputRevision,
      previousState: PREVIOUS_READY_STATE,
    };

    await expect(harness.repository.activateGeneration(input)).resolves.toBe(
      true,
    );
    catalogUpdatedAt = "2026-08-03T10:04:00.000Z";
    await expect(harness.repository.activateGeneration(input)).resolves.toBe(
      true,
    );

    expect(
      harness.statements.filter(
        ({ statement }) =>
          statement.includes("UPDATE codex_pet_related_state") &&
          statement.includes("previous_generation_id = active_generation_id"),
      ),
    ).toHaveLength(1);
  });

  it("rejects activation retries with a different ranking revision", async () => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-2",
            active: "generation-2",
            previous: "generation-1",
            status: "ready",
            rankingRevision: "ranking-v2",
          })
        : { resultSets: [] },
    );

    await expect(
      harness.repository.activateGeneration({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:03:00.000Z",
        inputScope: EMPTY_INPUT_SCOPE,
        expectedInputRevision: EMPTY_INPUT_REVISION,
        previousState: null,
      }),
    ).resolves.toBe(false);
    expect(
      harness.statements.some(({ statement }) =>
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

    const alreadyReady = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-2",
            active: "generation-2",
            previous: "generation-1",
            status: "ready",
          })
        : { resultSets: [] },
    );
    await expect(
      alreadyReady.repository.markGenerationFailed({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        failureReason: "vector_validation_failed",
        updatedAt: "2026-08-03T10:04:00.000Z",
      }),
    ).resolves.toBe(false);
    expect(
      alreadyReady.statements.some(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it("accepts an identical already-persisted failure as an idempotent retry", async () => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-2",
            active: "generation-1",
            previous: "generation-0",
            status: "failed",
            rankingRevision: "ranking-v1",
            failureReason: "vector_validation_failed",
          })
        : { resultSets: [] },
    );

    await expect(
      harness.repository.markGenerationFailed({
        generationId: "generation-2",
        rankingRevision: "ranking-v1",
        failureReason: "vector_validation_failed",
        updatedAt: "2026-08-03T10:04:00.000Z",
      }),
    ).resolves.toBe(true);
    expect(
      harness.statements.some(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toBe(false);
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

  it("cleans retained generations only for the stable ready token", async () => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-2",
            active: "generation-2",
            previous: "generation-1",
            status: "ready",
          })
        : { resultSets: [] },
    );

    await expect(
      harness.repository.cleanupGenerations({
        expectedGenerationId: "generation-2",
      }),
    ).resolves.toBe(true);

    expect(harness.transactions).toBe(1);
    expect(harness.statements.every(({ transactional }) => transactional)).toBe(
      true,
    );
    const cleanup = harness.statements.find(({ statement }) =>
      statement.includes("DELETE FROM codex_pet_related_snapshots"),
    );
    expect(cleanup?.statement).toContain(
      "generation_id != $active_generation_id",
    );
    expect(cleanup?.statement).toContain(
      "generation_id != $previous_generation_id",
    );
    expect(cleanup?.params).toEqual({
      $active_generation_id: { textValue: "generation-2" },
      $previous_generation_id: { textValue: "generation-1" },
    });
  });

  it("preserves newer inactive rows when another token is building", async () => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-3",
            active: "generation-2",
            previous: "generation-1",
            status: "building",
          })
        : { resultSets: [] },
    );

    await expect(
      harness.repository.cleanupGenerations({
        expectedGenerationId: "generation-2",
      }),
    ).resolves.toBe(false);

    expect(harness.transactions).toBe(1);
    expect(
      harness.statements.some(({ statement }) =>
        statement.includes("DELETE FROM codex_pet_related_snapshots"),
      ),
    ).toBe(false);
  });

  it.each([
    {
      name: "failed requested generation",
      state: {
        requested: "generation-2",
        active: "generation-1",
        previous: "generation-0",
        status: "failed",
      },
    },
    {
      name: "superseded unretained generation",
      state: {
        requested: "generation-3",
        active: "generation-1",
        previous: "generation-0",
        status: "building",
      },
    },
  ])("deletes snapshots only for the exact $name", async ({ state }) => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult(state)
        : { resultSets: [] },
    );

    await expect(
      harness.repository.cleanupInactiveGeneration({
        expectedGenerationId: "generation-2",
      }),
    ).resolves.toBe(true);

    const cleanup = harness.statements.find(({ statement }) =>
      statement.includes("DELETE FROM codex_pet_related_snapshots"),
    );
    expect(cleanup?.transactional).toBe(true);
    expect(cleanup?.statement).toContain(
      "generation_id = $inactive_generation_id",
    );
    expect(cleanup?.params).toEqual({
      $inactive_generation_id: { textValue: "generation-2" },
    });
  });

  it("deletes an inactive generation when no singleton state remains", async () => {
    const harness = createHarness();

    await expect(
      harness.repository.cleanupInactiveGeneration({
        expectedGenerationId: "generation-2",
      }),
    ).resolves.toBe(true);

    const cleanup = harness.statements.find(({ statement }) =>
      statement.includes("DELETE FROM codex_pet_related_snapshots"),
    );
    expect(cleanup?.transactional).toBe(true);
    expect(cleanup?.params).toEqual({
      $inactive_generation_id: { textValue: "generation-2" },
    });
  });

  it.each([
    {
      name: "still building",
      requested: "generation-2",
      active: "generation-1",
      previous: "generation-0",
      status: "building",
    },
    {
      name: "already active",
      requested: "generation-2",
      active: "generation-2",
      previous: "generation-1",
      status: "failed",
    },
    {
      name: "retained as previous",
      requested: "generation-2",
      active: "generation-3",
      previous: "generation-2",
      status: "failed",
    },
  ])("preserves snapshots when the inactive token is $name", async (scenario) => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult(scenario)
        : { resultSets: [] },
    );

    await expect(
      harness.repository.cleanupInactiveGeneration({
        expectedGenerationId: "generation-2",
      }),
    ).resolves.toBe(false);
    expect(
      harness.statements.some(({ statement }) =>
        statement.includes("DELETE FROM codex_pet_related_snapshots"),
      ),
    ).toBe(false);
  });

  it("atomically recovers once and returns the same result for an identical retry", async () => {
    let state = {
      requested: "generation-2",
      active: "generation-2",
      previous: "generation-1",
      status: "ready",
      rankingRevision: "ranking-v1",
    };
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT state_id")) {
        return stateResult(state);
      }
      if (statement.includes("SELECT DISTINCT ranking_revision")) {
        return {
          resultSets: [
            { rows: [{ items: [{ textValue: "ranking-v0" }] }] },
          ],
        };
      }
      if (statement.includes("UPDATE codex_pet_related_state")) {
        state = {
          requested: "generation-1",
          active: "generation-1",
          previous: "generation-2",
          status: "ready",
          rankingRevision: "ranking-v0",
        };
      }
      return { resultSets: [] };
    });
    const input = {
      expectedRequestedGenerationId: "generation-2",
      expectedStatus: "ready" as const,
      expectedActiveGenerationId: "generation-2",
      targetPreviousGenerationId: "generation-1",
      expectedRankingRevision: "ranking-v0",
      updatedAt: "2026-08-03T10:05:00.000Z",
    };
    const expected = {
      activeGenerationId: "generation-1",
      previousGenerationId: "generation-2",
      rankingRevision: "ranking-v0",
    };

    await expect(
      harness.repository.recoverPreviousGeneration(input),
    ).resolves.toEqual(expected);
    await expect(
      harness.repository.recoverPreviousGeneration(input),
    ).resolves.toEqual(expected);
    expect(harness.transactions).toBe(2);
    const update = harness.statements.find(({ statement }) =>
      statement.includes("UPDATE codex_pet_related_state"),
    );
    expect(update?.transactional).toBe(true);
    expect(update?.params).toMatchObject({
      $expected_requested_generation_id: { textValue: "generation-2" },
      $expected_active_generation_id: { textValue: "generation-2" },
      $target_previous_generation_id: { textValue: "generation-1" },
      $ranking_revision: { textValue: "ranking-v0" },
      $expected_status: { textValue: "ready" },
      $ready_status: { textValue: "ready" },
    });
    expect(update?.statement).toContain(
      "active_generation_id = $expected_active_generation_id",
    );
    expect(update?.statement).toContain(
      "previous_generation_id = $target_previous_generation_id",
    );
    expect(
      harness.statements.filter(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toHaveLength(1);
    expect(
      harness.statements.filter(({ statement }) =>
        statement.includes("SELECT DISTINCT ranking_revision"),
      ),
    ).toHaveLength(1);
  });

  it("rejects recovery when the retained ranking revision is incompatible", async () => {
    const harness = createHarness(async (statement) => {
      if (statement.includes("SELECT state_id")) {
        return stateResult({
          requested: "generation-2",
          active: "generation-2",
          previous: "generation-1",
          status: "ready",
          rankingRevision: "ranking-v1",
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
      harness.repository.recoverPreviousGeneration({
        expectedRequestedGenerationId: "generation-2",
        expectedStatus: "ready",
        expectedActiveGenerationId: "generation-2",
        targetPreviousGenerationId: "generation-1",
        expectedRankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:05:00.000Z",
      }),
    ).resolves.toBeNull();
    expect(
      harness.statements.filter(({ statement }) =>
        statement.includes("SELECT DISTINCT ranking_revision"),
      ),
    ).toHaveLength(1);
    expect(
      harness.statements.some(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it("rejects an incompatible retry after an older revision was recovered", async () => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-1",
            active: "generation-1",
            previous: "generation-2",
            status: "ready",
            rankingRevision: "ranking-v0",
          })
        : { resultSets: [] },
    );

    await expect(
      harness.repository.recoverPreviousGeneration({
        expectedRequestedGenerationId: "generation-2",
        expectedStatus: "ready",
        expectedActiveGenerationId: "generation-2",
        targetPreviousGenerationId: "generation-1",
        expectedRankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:05:00.000Z",
      }),
    ).resolves.toBeNull();
    expect(
      harness.statements.some(
        ({ statement }) =>
          statement.includes("SELECT DISTINCT ranking_revision") ||
          statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it.each(["failed", "building"] as const)(
    "recovers from an exact captured %s state without weakening token guards",
    async (expectedStatus) => {
      let recovered = false;
      const harness = createHarness(async (statement) => {
        if (statement.includes("SELECT state_id")) {
          return recovered
            ? stateResult({
                requested: "generation-1",
                active: "generation-1",
                previous: "generation-2",
                status: "ready",
                rankingRevision: "ranking-v0",
              })
            : stateResult({
                requested: "generation-incomplete",
                active: "generation-2",
                previous: "generation-1",
                status: expectedStatus,
                failureReason:
                  expectedStatus === "failed" ? "rebuild_failed" : null,
              });
        }
        if (statement.includes("SELECT DISTINCT ranking_revision")) {
          return {
            resultSets: [
              { rows: [{ items: [{ textValue: "ranking-v0" }] }] },
            ],
          };
        }
        if (statement.includes("UPDATE codex_pet_related_state")) {
          recovered = true;
        }
        return { resultSets: [] };
      });
      const input = {
        expectedRequestedGenerationId: "generation-incomplete",
        expectedStatus,
        expectedActiveGenerationId: "generation-2",
        targetPreviousGenerationId: "generation-1",
        expectedRankingRevision: "ranking-v0",
        updatedAt: "2026-08-03T10:05:00.000Z",
      };
      const expected = {
        activeGenerationId: "generation-1",
        previousGenerationId: "generation-2",
        rankingRevision: "ranking-v0",
      };

      await expect(
        harness.repository.recoverPreviousGeneration(input),
      ).resolves.toEqual(expected);
      await expect(
        harness.repository.recoverPreviousGeneration(input),
      ).resolves.toEqual(expected);

      const update = harness.statements.find(({ statement }) =>
        statement.includes("UPDATE codex_pet_related_state"),
      );
      expect(update?.params).toMatchObject({
        $expected_requested_generation_id: {
          textValue: "generation-incomplete",
        },
        $expected_status: { textValue: expectedStatus },
        $ready_status: { textValue: "ready" },
      });
      expect(update?.statement).toContain(
        "requested_generation_id = $expected_requested_generation_id",
      );
      expect(update?.statement).toContain("status = $expected_status");
      expect(
        harness.statements.filter(({ statement }) =>
          statement.includes("UPDATE codex_pet_related_state"),
        ),
      ).toHaveLength(1);
      if (expectedStatus === "building") {
        await expect(
          harness.repository.activateGeneration({
            generationId: "generation-incomplete",
            rankingRevision: "ranking-v1",
            updatedAt: "2026-08-03T10:06:00.000Z",
            inputScope: EMPTY_INPUT_SCOPE,
            expectedInputRevision: EMPTY_INPUT_REVISION,
            previousState: null,
          }),
        ).resolves.toBe(false);
      }
    },
  );

  it.each([
    {
      name: "requested token",
      actualRequested: "generation-newer",
      actualStatus: "failed" as const,
    },
    {
      name: "status",
      actualRequested: "generation-incomplete",
      actualStatus: "building" as const,
    },
  ])("rejects recovery when the captured $name changed", async (scenario) => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: scenario.actualRequested,
            active: "generation-2",
            previous: "generation-1",
            status: scenario.actualStatus,
          })
        : { resultSets: [] },
    );

    await expect(
      harness.repository.recoverPreviousGeneration({
        expectedRequestedGenerationId: "generation-incomplete",
        expectedStatus: "failed",
        expectedActiveGenerationId: "generation-2",
        targetPreviousGenerationId: "generation-1",
        expectedRankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:05:00.000Z",
      }),
    ).resolves.toBeNull();
    expect(
      harness.statements.some(
        ({ statement }) =>
          statement.includes("SELECT DISTINCT ranking_revision") ||
          statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toBe(false);
  });

  it("rejects recovery when the captured generation pair is stale", async () => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-3",
            active: "generation-3",
            previous: "generation-2",
            status: "ready",
          })
        : { resultSets: [] },
    );

    await expect(
      harness.repository.recoverPreviousGeneration({
        expectedRequestedGenerationId: "generation-2",
        expectedStatus: "ready",
        expectedActiveGenerationId: "generation-2",
        targetPreviousGenerationId: "generation-1",
        expectedRankingRevision: "ranking-v1",
        updatedAt: "2026-08-03T10:05:00.000Z",
      }),
    ).resolves.toBeNull();
    expect(
      harness.statements.some(
        ({ statement }) =>
          statement.includes("SELECT DISTINCT ranking_revision") ||
          statement.includes("UPDATE codex_pet_related_state"),
      ),
    ).toBe(false);
  });
});
