import type { Session } from "ydb-sdk";

import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";
import { isYdbConfigured, TypedValues, withSession } from "@/lib/ydb/client";
import { rowsFromResult, textAt, uintAt } from "@/lib/ydb/result";
import { TABLES } from "@/lib/ydb/schema";

export type RelatedPetsGenerationStatus = "building" | "ready" | "failed";

export type RelatedPetsState = {
  requestedGenerationId: string | null;
  activeGenerationId: string | null;
  previousGenerationId: string | null;
  status: RelatedPetsGenerationStatus;
  rankingRevision: string;
  failureReason: string | null;
  updatedAt: string;
};

export type RelatedPetsSnapshot = {
  generationId: string;
  sourceSlug: string;
  rankingRevision: string;
  relatedSlugs: string[];
  createdAt: string;
};

export type RelatedPetsRankingInputScope = {
  embeddingModelRevisions: readonly string[];
  captionRevision: string | null;
  annotationRevision?: string | null;
};

export type RecoverPreviousRelatedPetsGenerationInput = {
  expectedRequestedGenerationId: string;
  expectedStatus: RelatedPetsGenerationStatus;
  expectedActiveGenerationId: string;
  targetPreviousGenerationId: string;
  expectedRankingRevision: string;
  updatedAt: string;
};

export type RecoverPreviousRelatedPetsGenerationResult = {
  activeGenerationId: string;
  previousGenerationId: string;
  rankingRevision: string;
};

type TypedValueFactory = {
  utf8: (value: string) => unknown;
  json: (value: string) => unknown;
};

type Execute = (
  statement: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

type RelatedPetsRepositoryDependencies = {
  isConfigured: () => boolean;
  values: TypedValueFactory;
  execute: Execute;
  transaction: <T>(operation: (execute: Execute) => Promise<T>) => Promise<T>;
};

const RELATED_PETS_STATE_ID = "active";
const RELATED_PETS_STATUSES = new Set<RelatedPetsGenerationStatus>([
  "building",
  "ready",
  "failed",
]);

function areRelatedPetsStatesEqual(
  actual: RelatedPetsState | null,
  expected: RelatedPetsState | null,
): boolean {
  if (!actual || !expected) return actual === expected;
  return (
    actual.requestedGenerationId === expected.requestedGenerationId &&
    actual.activeGenerationId === expected.activeGenerationId &&
    actual.previousGenerationId === expected.previousGenerationId &&
    actual.status === expected.status &&
    actual.rankingRevision === expected.rankingRevision &&
    actual.failureReason === expected.failureReason &&
    actual.updatedAt === expected.updatedAt
  );
}

function isRequestedBuildState(
  state: RelatedPetsState | null,
  input: {
    generationId: string;
    rankingRevision: string;
    updatedAt: string;
  },
): boolean {
  return (
    state?.requestedGenerationId === input.generationId &&
    state.status === "building" &&
    state.rankingRevision === input.rankingRevision &&
    state.failureReason === null &&
    state.updatedAt === input.updatedAt
  );
}

export function createRelatedPetsRepository(
  dependencies: RelatedPetsRepositoryDependencies,
) {
  return {
    getState,
    getRankingInputRevision,
    getSnapshot,
    requestBuild,
    writeSnapshot,
    activateGeneration,
    markGenerationFailed,
    cleanupGenerations,
    cleanupInactiveGeneration,
    recoverPreviousGeneration,
  };

  async function getState(): Promise<RelatedPetsState | null> {
    if (!dependencies.isConfigured()) return null;
    return getStateWithExecute(dependencies.execute);
  }

  async function getStateWithExecute(
    execute: Execute,
  ): Promise<RelatedPetsState | null> {
    const result = await execute(
      `
DECLARE $state_id AS Utf8;

SELECT state_id,
       requested_generation_id,
       active_generation_id,
       previous_generation_id,
       status,
       ranking_revision,
       failure_reason,
       updated_at
FROM ${TABLES.relatedState}
WHERE state_id = $state_id
LIMIT 1;
      `,
      { $state_id: dependencies.values.utf8(RELATED_PETS_STATE_ID) },
    );
    const row = rowsFromResult(result)[0];
    if (!row) return null;

    if (textAt(row, 0) !== RELATED_PETS_STATE_ID) {
      throw new Error("Invalid related pets state id.");
    }
    const status = textAt(row, 4);
    if (!RELATED_PETS_STATUSES.has(status as RelatedPetsGenerationStatus)) {
      throw new Error("Invalid related pets state status.");
    }
    const rankingRevision = textAt(row, 5);
    if (!rankingRevision) {
      throw new Error("Invalid related pets ranking revision.");
    }

    return {
      requestedGenerationId: textAt(row, 1) || null,
      activeGenerationId: textAt(row, 2) || null,
      previousGenerationId: textAt(row, 3) || null,
      status: status as RelatedPetsGenerationStatus,
      rankingRevision,
      failureReason: textAt(row, 6) || null,
      updatedAt: textAt(row, 7),
    };
  }

  async function getRankingInputRevision(
    scope: RelatedPetsRankingInputScope,
  ): Promise<string | null> {
    if (!dependencies.isConfigured()) return null;
    return getRankingInputRevisionWithExecute(dependencies.execute, scope);
  }

  async function getRankingInputRevisionWithExecute(
    execute: Execute,
    scope: RelatedPetsRankingInputScope,
  ): Promise<string> {
    return JSON.stringify({
      catalog: await getCatalogRevisionWithExecute(execute),
      embeddings: await getEmbeddingRevisionWithExecute(
        execute,
        scope.embeddingModelRevisions,
      ),
      captions: scope.captionRevision
        ? await getCaptionRevisionWithExecute(execute, scope.captionRevision)
        : null,
    });
  }

  async function getCatalogRevisionWithExecute(
    execute: Execute,
  ): Promise<string> {
    const result = await execute(
      `
DECLARE $status AS Utf8;

SELECT slug,
       updated_at
FROM ${TABLES.pets}
WHERE status = $status
ORDER BY slug;
      `,
      { $status: dependencies.values.utf8("approved") },
    );
    return JSON.stringify(
      rowsFromResult(result).map((row) => {
        const slug = textAt(row, 0);
        const updatedAt = textAt(row, 1);
        if (!slug || !updatedAt) {
          throw new Error("Invalid related pets catalog revision row.");
        }
        return [slug, updatedAt];
      }),
    );
  }

  async function getEmbeddingRevisionWithExecute(
    execute: Execute,
    modelRevisions: readonly string[],
  ): Promise<string> {
    const revisions = [...new Set(modelRevisions.map((item) => item.trim()))]
      .filter(Boolean)
      .sort();
    const revisionRows: Array<
      [string, Array<[string, string, number, string]>]
    > = [];
    for (const modelRevision of revisions) {
      const result = await execute(
        `
DECLARE $model_revision AS Utf8;

SELECT pet_slug,
       source_hash,
       dimensions,
       updated_at
FROM ${TABLES.searchEmbeddings}
WHERE model_revision = $model_revision
ORDER BY pet_slug;
        `,
        { $model_revision: dependencies.values.utf8(modelRevision) },
      );
      revisionRows.push([
        modelRevision,
        rowsFromResult(result).map((row) => {
          const slug = textAt(row, 0);
          const sourceHash = textAt(row, 1);
          const dimensions = uintAt(row, 2);
          const updatedAt = textAt(row, 3);
          if (!slug || !sourceHash || dimensions <= 0 || !updatedAt) {
            throw new Error("Invalid related pets embedding revision row.");
          }
          return [slug, sourceHash, dimensions, updatedAt];
        }),
      ]);
    }
    return JSON.stringify(revisionRows);
  }

  async function getCaptionRevisionWithExecute(
    execute: Execute,
    captionRevision: string,
  ): Promise<string> {
    const result = await execute(
      `
DECLARE $caption_revision AS Utf8;

SELECT pet_slug,
       source_hash,
       updated_at
FROM ${TABLES.searchCaptions}
WHERE caption_revision = $caption_revision
ORDER BY pet_slug;
      `,
      { $caption_revision: dependencies.values.utf8(captionRevision) },
    );
    return JSON.stringify([
      captionRevision,
      rowsFromResult(result).map((row) => {
        const slug = textAt(row, 0);
        const sourceHash = textAt(row, 1);
        const updatedAt = textAt(row, 2);
        if (!slug || !sourceHash || !updatedAt) {
          throw new Error("Invalid related pets caption revision row.");
        }
        return [slug, sourceHash, updatedAt];
      }),
    ]);
  }

  async function getSnapshot(
    generationId: string,
    sourceSlug: string,
  ): Promise<RelatedPetsSnapshot | null> {
    if (!dependencies.isConfigured()) return null;
    const result = await dependencies.execute(
      `
DECLARE $generation_id AS Utf8;
DECLARE $source_slug AS Utf8;

SELECT generation_id,
       source_slug,
       ranking_revision,
       related_slugs_json,
       created_at
FROM ${TABLES.relatedSnapshots}
WHERE generation_id = $generation_id
  AND source_slug = $source_slug
LIMIT 1;
      `,
      {
        $generation_id: dependencies.values.utf8(generationId),
        $source_slug: dependencies.values.utf8(sourceSlug),
      },
    );
    const row = rowsFromResult(result)[0];
    if (!row) return null;

    const storedSourceSlug = textAt(row, 1);
    return {
      generationId: textAt(row, 0),
      sourceSlug: storedSourceSlug,
      rankingRevision: textAt(row, 2),
      relatedSlugs: parseRelatedSlugs(textAt(row, 3), storedSourceSlug),
      createdAt: textAt(row, 4),
    };
  }

  async function requestBuild(input: {
    generationId: string;
    rankingRevision: string;
    updatedAt: string;
    expectedState: RelatedPetsState | null;
    inputScope: RelatedPetsRankingInputScope;
    expectedInputRevision: string;
  }): Promise<boolean> {
    if (!dependencies.isConfigured()) return false;
    return dependencies.transaction(async (execute) => {
      const state = await getStateWithExecute(execute);
      if (isRequestedBuildState(state, input)) return true;
      const inputRevision = await getRankingInputRevisionWithExecute(
        execute,
        input.inputScope,
      );
      if (inputRevision !== input.expectedInputRevision) return false;
      if (!areRelatedPetsStatesEqual(state, input.expectedState)) return false;

      const params = {
        $state_id: dependencies.values.utf8(RELATED_PETS_STATE_ID),
        $generation_id: dependencies.values.utf8(input.generationId),
        $status: dependencies.values.utf8("building"),
        $ranking_revision: dependencies.values.utf8(input.rankingRevision),
        $updated_at: dependencies.values.utf8(input.updatedAt),
      };
      if (state) {
        await execute(
          `
DECLARE $state_id AS Utf8;
DECLARE $generation_id AS Utf8;
DECLARE $status AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $expected_updated_at AS Utf8;

UPDATE ${TABLES.relatedState}
SET requested_generation_id = $generation_id,
    status = $status,
    ranking_revision = $ranking_revision,
    failure_reason = NULL,
    updated_at = $updated_at
WHERE state_id = $state_id
  AND updated_at = $expected_updated_at;
          `,
          {
            ...params,
            $expected_updated_at: dependencies.values.utf8(state.updatedAt),
          },
        );
      } else {
        await execute(
          `
DECLARE $state_id AS Utf8;
DECLARE $generation_id AS Utf8;
DECLARE $status AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.relatedState}
(state_id, requested_generation_id, status, ranking_revision, failure_reason, updated_at)
VALUES
($state_id, $generation_id, $status, $ranking_revision, NULL, $updated_at);
          `,
          params,
        );
      }

      return isRequestedBuildState(
        await getStateWithExecute(execute),
        input,
      );
    });
  }

  async function writeSnapshot(input: RelatedPetsSnapshot): Promise<void> {
    if (!dependencies.isConfigured()) return;
    const relatedSlugs = validateRelatedSlugs(
      input.relatedSlugs,
      input.sourceSlug,
    );
    await dependencies.execute(
      `
DECLARE $generation_id AS Utf8;
DECLARE $source_slug AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $related_slugs_json AS Json;
DECLARE $created_at AS Utf8;

UPSERT INTO ${TABLES.relatedSnapshots}
(generation_id, source_slug, ranking_revision, related_slugs_json, created_at)
VALUES
($generation_id, $source_slug, $ranking_revision, $related_slugs_json, $created_at);
      `,
      {
        $generation_id: dependencies.values.utf8(input.generationId),
        $source_slug: dependencies.values.utf8(input.sourceSlug),
        $ranking_revision: dependencies.values.utf8(input.rankingRevision),
        $related_slugs_json: dependencies.values.json(
          JSON.stringify(relatedSlugs),
        ),
        $created_at: dependencies.values.utf8(input.createdAt),
      },
    );
  }

  async function activateGeneration(input: {
    generationId: string;
    rankingRevision: string;
    updatedAt: string;
    inputScope: RelatedPetsRankingInputScope;
    expectedInputRevision: string;
    previousState: RelatedPetsState | null;
  }): Promise<boolean> {
    if (!dependencies.isConfigured()) return false;
    return dependencies.transaction(async (execute) => {
      const state = await getStateWithExecute(execute);
      if (
        state?.status === "ready" &&
        state.requestedGenerationId === input.generationId &&
        state.activeGenerationId === input.generationId &&
        state.rankingRevision === input.rankingRevision
      ) {
        return true;
      }
      const inputRevision = await getRankingInputRevisionWithExecute(
        execute,
        input.inputScope,
      );
      if (inputRevision !== input.expectedInputRevision) {
        if (
          state?.requestedGenerationId === input.generationId &&
          state.status === "building" &&
          state.rankingRevision === input.rankingRevision
        ) {
          await restoreStateAfterStaleBuild(execute, input);
        }
        return false;
      }
      if (
        state?.requestedGenerationId !== input.generationId ||
        state.status !== "building" ||
        state.activeGenerationId === input.generationId ||
        state.rankingRevision !== input.rankingRevision
      ) {
        return false;
      }

      await execute(
        `
DECLARE $state_id AS Utf8;
DECLARE $generation_id AS Utf8;
DECLARE $building_status AS Utf8;
DECLARE $ready_status AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.relatedState}
SET previous_generation_id = active_generation_id,
    active_generation_id = $generation_id,
    requested_generation_id = $generation_id,
    status = $ready_status,
    ranking_revision = $ranking_revision,
    failure_reason = NULL,
    updated_at = $updated_at
WHERE state_id = $state_id
  AND requested_generation_id = $generation_id
  AND status = $building_status
  AND ranking_revision = $ranking_revision
  AND (active_generation_id IS NULL
       OR active_generation_id != $generation_id);
        `,
        {
          $state_id: dependencies.values.utf8(RELATED_PETS_STATE_ID),
          $generation_id: dependencies.values.utf8(input.generationId),
          $building_status: dependencies.values.utf8("building"),
          $ready_status: dependencies.values.utf8("ready"),
          $ranking_revision: dependencies.values.utf8(input.rankingRevision),
          $updated_at: dependencies.values.utf8(input.updatedAt),
        },
      );
      return true;
    });
  }

  async function restoreStateAfterStaleBuild(
    execute: Execute,
    input: {
      generationId: string;
      rankingRevision: string;
      updatedAt: string;
      previousState: RelatedPetsState | null;
    },
  ): Promise<void> {
    const previous = await getRestorableStateAfterStaleBuild(
      execute,
      input.previousState,
    );
    if (!previous) {
      await execute(
        `
DECLARE $state_id AS Utf8;
DECLARE $generation_id AS Utf8;
DECLARE $building_status AS Utf8;
DECLARE $ranking_revision AS Utf8;

DELETE FROM ${TABLES.relatedState}
WHERE state_id = $state_id
  AND requested_generation_id = $generation_id
  AND status = $building_status
  AND ranking_revision = $ranking_revision;
        `,
        {
          $state_id: dependencies.values.utf8(RELATED_PETS_STATE_ID),
          $generation_id: dependencies.values.utf8(input.generationId),
          $building_status: dependencies.values.utf8("building"),
          $ranking_revision: dependencies.values.utf8(input.rankingRevision),
        },
      );
      return;
    }

    const requestedValue = previous.requestedGenerationId
      ? "$previous_requested_generation_id"
      : "NULL";
    const activeValue = previous.activeGenerationId
      ? "$previous_active_generation_id"
      : "NULL";
    const retainedValue = previous.previousGenerationId
      ? "$previous_generation_id"
      : "NULL";
    const failureValue = previous.failureReason
      ? "$previous_failure_reason"
      : "NULL";
    await execute(
      `
DECLARE $state_id AS Utf8;
DECLARE $generation_id AS Utf8;
DECLARE $building_status AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $previous_status AS Utf8;
DECLARE $previous_ranking_revision AS Utf8;
DECLARE $updated_at AS Utf8;
${previous.requestedGenerationId ? "DECLARE $previous_requested_generation_id AS Utf8;" : ""}
${previous.activeGenerationId ? "DECLARE $previous_active_generation_id AS Utf8;" : ""}
${previous.previousGenerationId ? "DECLARE $previous_generation_id AS Utf8;" : ""}
${previous.failureReason ? "DECLARE $previous_failure_reason AS Utf8;" : ""}

UPDATE ${TABLES.relatedState}
SET requested_generation_id = ${requestedValue},
    active_generation_id = ${activeValue},
    previous_generation_id = ${retainedValue},
    status = $previous_status,
    ranking_revision = $previous_ranking_revision,
    failure_reason = ${failureValue},
    updated_at = $updated_at
WHERE state_id = $state_id
  AND requested_generation_id = $generation_id
  AND status = $building_status
  AND ranking_revision = $ranking_revision;
      `,
      {
        $state_id: dependencies.values.utf8(RELATED_PETS_STATE_ID),
        $generation_id: dependencies.values.utf8(input.generationId),
        $building_status: dependencies.values.utf8("building"),
        $ranking_revision: dependencies.values.utf8(input.rankingRevision),
        $previous_status: dependencies.values.utf8(previous.status),
        $previous_ranking_revision: dependencies.values.utf8(
          previous.rankingRevision,
        ),
        $updated_at: dependencies.values.utf8(input.updatedAt),
        ...(previous.requestedGenerationId
          ? {
              $previous_requested_generation_id: dependencies.values.utf8(
                previous.requestedGenerationId,
              ),
            }
          : {}),
        ...(previous.activeGenerationId
          ? {
              $previous_active_generation_id: dependencies.values.utf8(
                previous.activeGenerationId,
              ),
            }
          : {}),
        ...(previous.previousGenerationId
          ? {
              $previous_generation_id: dependencies.values.utf8(
                previous.previousGenerationId,
              ),
            }
          : {}),
        ...(previous.failureReason
          ? {
              $previous_failure_reason: dependencies.values.utf8(
                previous.failureReason,
              ),
            }
          : {}),
      },
    );
  }

  async function getRestorableStateAfterStaleBuild(
    execute: Execute,
    previous: RelatedPetsState | null,
  ): Promise<RelatedPetsState | null> {
    if (!previous || previous.status !== "building") return previous;
    if (!previous.activeGenerationId) return null;

    const rankingRevision = await getGenerationRankingRevisionWithExecute(
      execute,
      previous.activeGenerationId,
    );
    if (!rankingRevision) return null;

    return {
      ...previous,
      requestedGenerationId: previous.activeGenerationId,
      status: "ready",
      rankingRevision,
      failureReason: null,
    };
  }

  async function getGenerationRankingRevisionWithExecute(
    execute: Execute,
    generationId: string,
  ): Promise<string | null> {
    const result = await execute(
      `
DECLARE $generation_id AS Utf8;

SELECT DISTINCT ranking_revision
FROM ${TABLES.relatedSnapshots}
WHERE generation_id = $generation_id;
      `,
      {
        $generation_id: dependencies.values.utf8(generationId),
      },
    );
    const rows = rowsFromResult(result);
    if (rows.length === 0) return null;
    if (rows.length !== 1 || !textAt(rows[0], 0)) {
      throw new Error("Invalid related pets generation ranking revision.");
    }
    return textAt(rows[0], 0);
  }

  async function markGenerationFailed(input: {
    generationId: string;
    rankingRevision: string;
    failureReason: string;
    updatedAt: string;
  }): Promise<boolean> {
    if (!/^[a-z][a-z0-9_]{0,63}$/.test(input.failureReason)) {
      throw new Error("Invalid related pets failure reason.");
    }
    if (!dependencies.isConfigured()) return false;
    return dependencies.transaction(async (execute) => {
      const state = await getStateWithExecute(execute);
      if (
        state?.requestedGenerationId === input.generationId &&
        state.status === "failed" &&
        state.rankingRevision === input.rankingRevision &&
        state.failureReason === input.failureReason
      ) {
        return true;
      }
      if (
        state?.requestedGenerationId !== input.generationId ||
        state.status !== "building" ||
        state.rankingRevision !== input.rankingRevision
      ) {
        return false;
      }

      await execute(
        `
DECLARE $state_id AS Utf8;
DECLARE $generation_id AS Utf8;
DECLARE $building_status AS Utf8;
DECLARE $failed_status AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $failure_reason AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.relatedState}
SET status = $failed_status,
    ranking_revision = $ranking_revision,
    failure_reason = $failure_reason,
    updated_at = $updated_at
WHERE state_id = $state_id
  AND requested_generation_id = $generation_id
  AND status = $building_status
  AND ranking_revision = $ranking_revision;
        `,
        {
          $state_id: dependencies.values.utf8(RELATED_PETS_STATE_ID),
          $generation_id: dependencies.values.utf8(input.generationId),
          $building_status: dependencies.values.utf8("building"),
          $failed_status: dependencies.values.utf8("failed"),
          $ranking_revision: dependencies.values.utf8(input.rankingRevision),
          $failure_reason: dependencies.values.utf8(input.failureReason),
          $updated_at: dependencies.values.utf8(input.updatedAt),
        },
      );
      return true;
    });
  }

  async function cleanupGenerations(input: {
    expectedGenerationId: string;
  }): Promise<boolean> {
    if (!dependencies.isConfigured()) return false;
    return dependencies.transaction(async (execute) => {
      const state = await getStateWithExecute(execute);
      if (
        state?.status !== "ready" ||
        state.activeGenerationId !== input.expectedGenerationId ||
        state.requestedGenerationId !== input.expectedGenerationId
      ) {
        return false;
      }

      const previousFilter = state.previousGenerationId
        ? "\n  AND generation_id != $previous_generation_id"
        : "";
      await execute(
        `
DECLARE $active_generation_id AS Utf8;
${state.previousGenerationId ? "DECLARE $previous_generation_id AS Utf8;" : ""}

DELETE FROM ${TABLES.relatedSnapshots}
WHERE generation_id != $active_generation_id${previousFilter};
        `,
        {
          $active_generation_id: dependencies.values.utf8(
            state.activeGenerationId,
          ),
          ...(state.previousGenerationId
            ? {
                $previous_generation_id: dependencies.values.utf8(
                  state.previousGenerationId,
                ),
              }
            : {}),
        },
      );
      return true;
    });
  }

  async function cleanupInactiveGeneration(input: {
    expectedGenerationId: string;
  }): Promise<boolean> {
    if (!dependencies.isConfigured()) return false;
    return dependencies.transaction(async (execute) => {
      const state = await getStateWithExecute(execute);
      if (
        state?.activeGenerationId === input.expectedGenerationId ||
        state?.previousGenerationId === input.expectedGenerationId ||
        (state?.requestedGenerationId === input.expectedGenerationId &&
          state.status !== "failed")
      ) {
        return false;
      }

      await execute(
        `
DECLARE $inactive_generation_id AS Utf8;

DELETE FROM ${TABLES.relatedSnapshots}
WHERE generation_id = $inactive_generation_id;
        `,
        {
          $inactive_generation_id: dependencies.values.utf8(
            input.expectedGenerationId,
          ),
        },
      );
      return true;
    });
  }

  async function recoverPreviousGeneration(
    input: RecoverPreviousRelatedPetsGenerationInput,
  ): Promise<RecoverPreviousRelatedPetsGenerationResult | null> {
    if (!dependencies.isConfigured()) return null;
    return dependencies.transaction(async (execute) => {
      const state = await getStateWithExecute(execute);
      if (
        state?.status === "ready" &&
        state.requestedGenerationId === input.targetPreviousGenerationId &&
        state.activeGenerationId === input.targetPreviousGenerationId &&
        state.previousGenerationId === input.expectedActiveGenerationId &&
        state.rankingRevision === input.expectedRankingRevision
      ) {
        return {
          activeGenerationId: input.targetPreviousGenerationId,
          previousGenerationId: input.expectedActiveGenerationId,
          rankingRevision: state.rankingRevision,
        };
      }
      if (
        state?.status !== input.expectedStatus ||
        state.requestedGenerationId !==
          input.expectedRequestedGenerationId ||
        state.activeGenerationId !== input.expectedActiveGenerationId ||
        state.previousGenerationId !== input.targetPreviousGenerationId
      ) {
        return null;
      }

      const rankingRevision = await getGenerationRankingRevisionWithExecute(
        execute,
        input.targetPreviousGenerationId,
      );
      if (!rankingRevision) return null;
      if (rankingRevision !== input.expectedRankingRevision) return null;

      await execute(
        `
DECLARE $state_id AS Utf8;
DECLARE $expected_requested_generation_id AS Utf8;
DECLARE $expected_active_generation_id AS Utf8;
DECLARE $target_previous_generation_id AS Utf8;
DECLARE $expected_status AS Utf8;
DECLARE $ready_status AS Utf8;
DECLARE $ranking_revision AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${TABLES.relatedState}
SET requested_generation_id = $target_previous_generation_id,
    previous_generation_id = $expected_active_generation_id,
    active_generation_id = $target_previous_generation_id,
    status = $ready_status,
    ranking_revision = $ranking_revision,
    failure_reason = NULL,
    updated_at = $updated_at
WHERE state_id = $state_id
  AND requested_generation_id = $expected_requested_generation_id
  AND active_generation_id = $expected_active_generation_id
  AND previous_generation_id = $target_previous_generation_id
  AND status = $expected_status;
        `,
        {
          $state_id: dependencies.values.utf8(RELATED_PETS_STATE_ID),
          $expected_requested_generation_id: dependencies.values.utf8(
            input.expectedRequestedGenerationId,
          ),
          $expected_active_generation_id: dependencies.values.utf8(
            input.expectedActiveGenerationId,
          ),
          $target_previous_generation_id: dependencies.values.utf8(
            input.targetPreviousGenerationId,
          ),
          $expected_status: dependencies.values.utf8(input.expectedStatus),
          $ready_status: dependencies.values.utf8("ready"),
          $ranking_revision: dependencies.values.utf8(rankingRevision),
          $updated_at: dependencies.values.utf8(input.updatedAt),
        },
      );
      return {
        activeGenerationId: input.targetPreviousGenerationId,
        previousGenerationId: input.expectedActiveGenerationId,
        rankingRevision,
      };
    });
  }
}

function parseRelatedSlugs(value: string, sourceSlug: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Invalid related pets snapshot slugs.");
  }
  return validateRelatedSlugs(parsed, sourceSlug);
}

function validateRelatedSlugs(
  value: unknown,
  sourceSlug: string,
): string[] {
  if (
    !Array.isArray(value) ||
    value.length > RELATED_PETS_SNAPSHOT_DEPTH ||
    value.some(
      (slug) =>
        typeof slug !== "string" ||
        !slug ||
        slug === sourceSlug ||
        slug !== slug.trim(),
    ) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Invalid related pets snapshot slugs.");
  }
  return [...value] as string[];
}

type TxControl = { txId: string };

async function withSerializableTransaction<T>(
  operation: (execute: Execute) => Promise<T>,
): Promise<T> {
  return withSession(async (session: Session) => {
    const transaction = await session.beginTransaction({
      serializableReadWrite: {},
    });
    if (!transaction.id) {
      throw new Error("Unable to start related pets transaction.");
    }
    const txControl: TxControl = { txId: transaction.id };
    const execute: Execute = (statement, params) =>
      session.executeQuery(
        statement,
        params as NonNullable<Parameters<typeof session.executeQuery>[1]>,
        txControl,
      );

    try {
      const result = await operation(execute);
      await session.commitTransaction(txControl);
      return result;
    } catch (error) {
      try {
        await session.rollbackTransaction(txControl);
      } catch {
        // The transaction may already be aborted or committed by YDB.
      }
      throw error;
    }
  });
}

const repository = createRelatedPetsRepository({
  isConfigured: isYdbConfigured,
  values: TypedValues,
  execute: (statement, params) =>
    withSession((session) =>
      session.executeQuery(
        statement,
        params as NonNullable<Parameters<typeof session.executeQuery>[1]>,
      ),
    ),
  transaction: withSerializableTransaction,
});

export const getRelatedPetsState = repository.getState;
export const getRelatedPetsRankingInputRevision =
  repository.getRankingInputRevision;
export const getRelatedPetsSnapshot = repository.getSnapshot;
export const requestRelatedPetsBuild = repository.requestBuild;
export const writeRelatedPetsSnapshot = repository.writeSnapshot;
export const activateRelatedPetsGeneration = repository.activateGeneration;
export const markRelatedPetsGenerationFailed = repository.markGenerationFailed;
export const cleanupRelatedPetsGenerations = repository.cleanupGenerations;
export const cleanupInactiveRelatedPetsGeneration =
  repository.cleanupInactiveGeneration;
export const recoverPreviousRelatedPetsGeneration =
  repository.recoverPreviousGeneration;
