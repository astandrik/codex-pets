#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildRelatedPetDocument,
  buildRelatedPetQuery,
  createRelatedPetDocumentSourceHash,
  createRequestStartLimiter,
  createRelatedPetQuerySourceHash,
  embeddingToBuffer,
  parseBackfillArgs,
  runPetSearchBackfill,
} from "./lib/pet-search-backfill.mjs";
import {
  createEmbeddingRequest,
  requirePetSearchBackfillRevision,
} from "./lib/pet-search-provider-config.mjs";
import {
  TypedValues,
  executeYdbQuery,
  parseStringArray,
  rowsFromResult,
  textAt,
  uint32At,
  withYdbCliDriver,
} from "./lib/ydb-cli.mjs";

const PETS_TABLE = "codex_pets";
const EMBEDDINGS_TABLE = "codex_pet_search_embeddings";
const DEFAULT_TIMEOUT_MS = 800;
const REQUESTS_PER_MINUTE = 60;
const EMBEDDING_ENDPOINT =
  "https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding";

export async function main(argv = process.argv.slice(2)) {
  const options = parseBackfillArgs(argv);
  const revision = process.env.PET_SEARCH_MODEL_REVISION?.trim();
  const revisionDefinition =
    requirePetSearchBackfillRevision(revision);

  return withYdbCliDriver(async (driver) => {
    const embedDocument = options.mode === "apply"
      ? createEmbeddingProvider(
          readEmbeddingProviderConfig(),
          revisionDefinition,
        )
      : async () => {
          throw new Error("Dry-run must not call the embedding provider.");
        };
    const pets = await listApprovedPets(driver);
    const summary = await runPetSearchBackfill({
      options,
      revision,
      dimensions: revisionDefinition.dimensions,
      pets,
      getMetadata: (modelRevision, slug) =>
        getEmbeddingMetadata(driver, modelRevision, slug),
      embedDocument,
      upsert: (input) => upsertEmbedding(driver, input),
      ...(revisionDefinition.inputKind === "related-query"
        ? {
            buildInput: (pet) => buildRelatedPetQuery(pet, revision),
            createSourceHash: createRelatedPetQuerySourceHash,
          }
        : revisionDefinition.inputKind === "related-document"
          ? {
              buildInput: (pet) => buildRelatedPetDocument(pet, revision),
              createSourceHash: createRelatedPetDocumentSourceHash,
            }
          : {}),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
    if (summary.failed > 0) process.exitCode = 1;
    return summary;
  }, { requireExplicitTarget: options.mode === "apply" });
}

function readEmbeddingProviderConfig() {
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  const apiKeyFile = process.env.YANDEX_AI_STUDIO_API_KEY_FILE?.trim();
  if (!folderId || !apiKeyFile) {
    throw new Error(
      "--apply requires YANDEX_AI_STUDIO_FOLDER_ID and YANDEX_AI_STUDIO_API_KEY_FILE.",
    );
  }

  const apiKey = readFileSync(apiKeyFile, "utf8").trim();
  if (!apiKey) {
    throw new Error("YANDEX_AI_STUDIO_API_KEY_FILE is empty.");
  }

  const timeoutValue = Number(process.env.PET_SEARCH_EMBEDDING_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(timeoutValue) &&
      timeoutValue >= 50 && timeoutValue <= 5_000
    ? timeoutValue
    : DEFAULT_TIMEOUT_MS;
  return { folderId, apiKey, timeoutMs };
}

function createEmbeddingProvider(
  { folderId, apiKey, timeoutMs },
  revisionDefinition,
) {
  const reserveRateLimitSlot = createRequestStartLimiter({
    requestsPerMinute: REQUESTS_PER_MINUTE,
    sleep: delay,
  });

  return async function embedDocument(document) {
    await reserveRateLimitSlot();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${apiKey}`,
          "Content-Type": "application/json",
          "x-folder-id": folderId,
        },
        body: JSON.stringify(
          createEmbeddingRequest({
            folderId,
            definition: revisionDefinition,
            text: document,
          }),
        ),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Embedding provider returned HTTP ${response.status}.`);
      }

      const payload = await response.json();
      return Array.isArray(payload?.embedding) ? payload.embedding : [];
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Embedding provider request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function listApprovedPets(driver) {
  const result = await executeYdbQuery(
    driver,
    `
DECLARE $status AS Utf8;

SELECT slug, display_name, description, kind, tags_json
FROM ${PETS_TABLE}
WHERE status = $status
ORDER BY created_at DESC;
    `,
    { $status: TypedValues.utf8("approved") },
  );

  return rowsFromResult(result).map((row) => ({
    slug: textAt(row, 0),
    displayName: textAt(row, 1),
    description: textAt(row, 2),
    kind: textAt(row, 3),
    tags: parseStringArray(textAt(row, 4)),
    status: "approved",
  }));
}

async function getEmbeddingMetadata(driver, modelRevision, slug) {
  const result = await executeYdbQuery(
    driver,
    `
DECLARE $model_revision AS Utf8;
DECLARE $pet_slug AS Utf8;

SELECT source_hash, dimensions
FROM ${EMBEDDINGS_TABLE}
WHERE model_revision = $model_revision
  AND pet_slug = $pet_slug
LIMIT 1;
    `,
    {
      $model_revision: TypedValues.utf8(modelRevision),
      $pet_slug: TypedValues.utf8(slug),
    },
  );
  const row = rowsFromResult(result)[0];
  return row
    ? { sourceHash: textAt(row, 0), dimensions: uint32At(row, 1) }
    : null;
}

async function upsertEmbedding(driver, input) {
  await executeYdbQuery(
    driver,
    `
DECLARE $model_revision AS Utf8;
DECLARE $pet_slug AS Utf8;
DECLARE $source_hash AS Utf8;
DECLARE $dimensions AS Uint32;
DECLARE $embedding AS String;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${EMBEDDINGS_TABLE}
(model_revision, pet_slug, source_hash, dimensions, embedding, updated_at)
VALUES
($model_revision, $pet_slug, $source_hash, $dimensions, $embedding, $updated_at);
    `,
    {
      $model_revision: TypedValues.utf8(input.modelRevision),
      $pet_slug: TypedValues.utf8(input.slug),
      $source_hash: TypedValues.utf8(input.sourceHash),
      $dimensions: TypedValues.uint32(input.dimensions),
      $embedding: TypedValues.bytes(embeddingToBuffer(input.embedding)),
      $updated_at: TypedValues.utf8(input.updatedAt),
    },
  );
}

const invokedAsScript = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Backfill failed.");
    process.exitCode = 1;
  });
}
