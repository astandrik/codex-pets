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

  it("deletes snapshots only for the exact failed requested generation", async () => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult({
            requested: "generation-2",
            active: "generation-1",
            previous: "generation-0",
            status: "failed",
          })
        : { resultSets: [] },
    );

    expect(harness.repository.cleanupFailedGeneration).toBeTypeOf("function");
    await expect(
      harness.repository.cleanupFailedGeneration({
        expectedGenerationId: "generation-2",
      }),
    ).resolves.toBe(true);

    const cleanup = harness.statements.find(({ statement }) =>
      statement.includes("DELETE FROM codex_pet_related_snapshots"),
    );
    expect(cleanup?.transactional).toBe(true);
    expect(cleanup?.statement).toContain(
      "generation_id = $failed_generation_id",
    );
    expect(cleanup?.params).toEqual({
      $failed_generation_id: { textValue: "generation-2" },
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
  ])("preserves snapshots when the failed token is $name", async (scenario) => {
    const harness = createHarness(async (statement) =>
      statement.includes("SELECT state_id")
        ? stateResult(scenario)
        : { resultSets: [] },
    );

    expect(harness.repository.cleanupFailedGeneration).toBeTypeOf("function");
    await expect(
      harness.repository.cleanupFailedGeneration({
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
