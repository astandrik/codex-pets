#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_MODEL_NAME,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
} from "../src/lib/pets/related-pets-annotation-contract.mjs";
import {
  createRequestStartLimiter,
  embeddingToBuffer,
} from "./lib/pet-search-backfill.mjs";
import {
  parseRelatedPetAnnotationBackfillArgs,
  runRelatedPetAnnotationEmbeddingBackfill,
} from "./lib/related-pets-annotation-backfill.mjs";
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
const ANNOTATIONS_TABLE = "codex_pet_related_annotations";
const EMBEDDINGS_TABLE = "codex_pet_search_embeddings";
const EMBEDDING_ENDPOINT =
  "https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding";
const DIMENSIONS = 768;

export async function main(argv = process.argv.slice(2)) {
  const options = parseRelatedPetAnnotationBackfillArgs(argv);
  const revision = process.env.PET_SEARCH_MODEL_REVISION?.trim();
  const role = revision === RELATED_PETS_ANNOTATION_QUERY_REVISION
    ? "query"
    : revision === RELATED_PETS_ANNOTATION_DOCUMENT_REVISION
      ? "document"
      : null;
  if (!role) {
    throw new Error(
      "PET_SEARCH_MODEL_REVISION must name a current annotation revision.",
    );
  }
  return withYdbCliDriver(async (driver) => {
    const providerConfig = options.mode === "apply"
      ? readProviderConfig()
      : null;
    const folderId = providerConfig?.folderId ??
      process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
    const annotationModelUri = folderId
      ? `gpt://${folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`
      : null;
    const embed = options.mode === "apply"
      ? createEmbeddingProvider(providerConfig)
      : async () => {
          throw new Error("Dry-run must not call embeddings.");
        };
    const summary = await runRelatedPetAnnotationEmbeddingBackfill({
      options,
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelRevision: revision,
      role,
      dimensions: DIMENSIONS,
      modelUri: annotationModelUri,
      pets: await listApprovedPets(driver),
      annotations: await listAnnotations(driver),
      getMetadata: (modelRevision, slug) =>
        getEmbeddingMetadata(driver, modelRevision, slug),
      embed,
      upsert: (input) => upsertEmbedding(driver, input),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
    if (summary.failed > 0) process.exitCode = 1;
    return summary;
  }, { requireExplicitTarget: options.mode === "apply" });
}

function readProviderConfig() {
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  if (!folderId) throw new Error("YANDEX_AI_STUDIO_FOLDER_ID is required.");
  const file = process.env.YANDEX_AI_STUDIO_API_KEY_FILE?.trim();
  if (!file) {
    throw new Error("--apply requires YANDEX_AI_STUDIO_API_KEY_FILE.");
  }
  const apiKey = readFileSync(file, "utf8").trim();
  if (!apiKey) throw new Error("YANDEX_AI_STUDIO_API_KEY_FILE is empty.");
  const raw = Number(process.env.PET_SEARCH_EMBEDDING_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(raw) && raw >= 50 && raw <= 5_000
    ? raw
    : 800;
  return { folderId, apiKey, timeoutMs };
}

function createEmbeddingProvider(config) {
  const reserve = createRequestStartLimiter({
    requestsPerMinute: 60,
    sleep: (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  });
  return async (text, role) => {
    await reserve();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const modelPath = role === "query"
        ? "text-embeddings-v2-query"
        : "text-embeddings-v2-doc";
      const response = await fetch(EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${config.apiKey}`,
          "Content-Type": "application/json",
          "x-folder-id": config.folderId,
        },
        body: JSON.stringify({
          modelUri: `emb://${config.folderId}/${modelPath}`,
          text,
          dim: String(DIMENSIONS),
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Embedding provider returned HTTP ${response.status}.`);
      }
      const payload = await response.json();
      return Array.isArray(payload?.embedding) ? payload.embedding : [];
    } finally {
      clearTimeout(timeout);
    }
  };
}

async function listApprovedPets(driver) {
  const result = await executeYdbQuery(driver, `
DECLARE $status AS Utf8;
SELECT slug, display_name, description, kind, tags_json
FROM ${PETS_TABLE}
WHERE status = $status
ORDER BY slug;
  `, { $status: TypedValues.utf8("approved") });
  return rowsFromResult(result).map((row) => ({
    slug: textAt(row, 0),
    displayName: textAt(row, 1),
    description: textAt(row, 2),
    kind: textAt(row, 3),
    tags: parseStringArray(textAt(row, 4)),
    status: "approved",
  }));
}

async function listAnnotations(driver) {
  const result = await executeYdbQuery(driver, `
DECLARE $revision AS Utf8;
SELECT pet_slug, source_hash, annotation_json, annotation_text
FROM ${ANNOTATIONS_TABLE}
WHERE annotation_revision = $revision;
  `, { $revision: TypedValues.utf8(RELATED_PETS_ANNOTATION_REVISION) });
  return rowsFromResult(result).map((row) => ({
    slug: textAt(row, 0),
    sourceHash: textAt(row, 1),
    annotationJson: textAt(row, 2),
    annotationText: textAt(row, 3),
  }));
}

async function getEmbeddingMetadata(driver, revision, slug) {
  const result = await executeYdbQuery(driver, `
DECLARE $revision AS Utf8;
DECLARE $slug AS Utf8;
SELECT source_hash, dimensions FROM ${EMBEDDINGS_TABLE}
WHERE model_revision = $revision AND pet_slug = $slug LIMIT 1;
  `, {
    $revision: TypedValues.utf8(revision),
    $slug: TypedValues.utf8(slug),
  });
  const row = rowsFromResult(result)[0];
  return row
    ? { sourceHash: textAt(row, 0), dimensions: uint32At(row, 1) }
    : null;
}

function upsertEmbedding(driver, input) {
  return executeYdbQuery(driver, `
DECLARE $revision AS Utf8;
DECLARE $slug AS Utf8;
DECLARE $source_hash AS Utf8;
DECLARE $dimensions AS Uint32;
DECLARE $embedding AS String;
DECLARE $updated_at AS Utf8;
UPSERT INTO ${EMBEDDINGS_TABLE}
(model_revision, pet_slug, source_hash, dimensions, embedding, updated_at)
VALUES ($revision, $slug, $source_hash, $dimensions, $embedding, $updated_at);
  `, {
    $revision: TypedValues.utf8(input.modelRevision),
    $slug: TypedValues.utf8(input.slug),
    $source_hash: TypedValues.utf8(input.sourceHash),
    $dimensions: TypedValues.uint32(input.dimensions),
    $embedding: TypedValues.bytes(embeddingToBuffer(input.embedding)),
    $updated_at: TypedValues.utf8(input.updatedAt),
  });
}

const invokedAsScript = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Backfill failed.");
    process.exitCode = 1;
  });
}
