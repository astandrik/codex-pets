#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
} from "../src/lib/pets/related-pets-annotation-contract.mjs";
import {
  embeddingToBuffer,
  createRequestStartLimiter,
} from "./lib/pet-search-backfill.mjs";
import {
  parseRelatedPetAnnotationBackfillArgs,
  runRelatedPetAnnotationEmbeddingBackfill,
} from "./lib/related-pets-annotation-backfill.mjs";
import { createRelatedPetsRebuildRequiredLog } from "./lib/related-pets-maintenance.mjs";

const require = createRequire(import.meta.url);
const {
  Driver,
  StaticCredentialsAuthService,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = require("ydb-sdk");

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
  if (!role) throw new Error("PET_SEARCH_MODEL_REVISION must name a current annotation revision.");
  const endpoint = process.env.YDB_PETS_ENDPOINT?.trim() || "grpc://127.0.0.1:2136";
  const database = process.env.YDB_PETS_DATABASE?.trim() || "/local";
  if (isLocalEndpoint(endpoint)) {
    process.env.YDB_ANONYMOUS_CREDENTIALS ??= "1";
    process.env.YDB_ENDPOINT ??= endpoint;
  }
  const providerConfig = readProviderConfig(options.mode);
  const driver = createDriver(endpoint, database);
  try {
    if (!(await driver.ready(15_000))) {
      throw new Error(`YDB driver is not ready for ${endpoint} ${database}.`);
    }
    const embed = options.mode === "apply"
      ? createEmbeddingProvider(providerConfig)
      : async () => { throw new Error("Dry-run must not call embeddings."); };
    const summary = await runRelatedPetAnnotationEmbeddingBackfill({
      options,
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelRevision: revision,
      role,
      dimensions: DIMENSIONS,
      pets: await listApprovedPets(driver),
      annotations: await listAnnotations(driver),
      getMetadata: (modelRevision, slug) =>
        getEmbeddingMetadata(driver, modelRevision, slug),
      embed,
      upsert: (input) => upsertEmbedding(driver, input),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
    if (options.mode === "apply" && summary.updated > 0) {
      console.log(JSON.stringify(createRelatedPetsRebuildRequiredLog()));
    }
    if (summary.failed > 0) process.exitCode = 1;
    return summary;
  } finally {
    await driver.destroy();
  }
}

function readProviderConfig(mode) {
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  if (!folderId) throw new Error("YANDEX_AI_STUDIO_FOLDER_ID is required.");
  let apiKey = "";
  if (mode === "apply") {
    const file = process.env.YANDEX_AI_STUDIO_API_KEY_FILE?.trim();
    if (!file) throw new Error("--apply requires YANDEX_AI_STUDIO_API_KEY_FILE.");
    apiKey = readFileSync(file, "utf8").trim();
    if (!apiKey) throw new Error("YANDEX_AI_STUDIO_API_KEY_FILE is empty.");
  }
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
      if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}.`);
      const payload = await response.json();
      return Array.isArray(payload?.embedding) ? payload.embedding : [];
    } finally { clearTimeout(timeout); }
  };
}

function createDriver(endpoint, database) {
  return new Driver({
    endpoint,
    database,
    authService: createAuthService(endpoint),
    clientOptions: {
      "grpc.max_receive_message_length": 16 * 1024 * 1024,
      "grpc.max_send_message_length": 16 * 1024 * 1024,
    },
    poolSettings: { minLimit: 1, maxLimit: 4, keepAlivePeriod: 30_000 },
  });
}
function createAuthService(endpoint) {
  const user = process.env.YDB_STATIC_CREDENTIALS_USER?.trim();
  if (!user) return getCredentialsFromEnv();
  const file = process.env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  const password = file
    ? readFileSync(file, "utf8").replace(/[\r\n]+$/, "")
    : process.env.YDB_STATIC_CREDENTIALS_PASSWORD?.trim();
  if (!password) throw new Error("YDB static credentials password is missing.");
  return new StaticCredentialsAuthService(
    user,
    password,
    process.env.YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT?.trim() || endpoint,
    getDefaultLogger(),
  );
}

async function listApprovedPets(driver) {
  const result = await execute(driver, `
DECLARE $status AS Utf8;
SELECT slug FROM ${PETS_TABLE} WHERE status = $status ORDER BY slug;
  `, { $status: TypedValues.utf8("approved") });
  return rows(result).map((row) => ({ slug: text(row, 0), status: "approved" }));
}
async function listAnnotations(driver) {
  const result = await execute(driver, `
DECLARE $revision AS Utf8;
SELECT pet_slug, source_hash, annotation_json, annotation_text
FROM ${ANNOTATIONS_TABLE}
WHERE annotation_revision = $revision;
  `, { $revision: TypedValues.utf8(RELATED_PETS_ANNOTATION_REVISION) });
  return rows(result).map((row) => ({
    slug: text(row, 0),
    sourceHash: text(row, 1),
    annotationJson: text(row, 2),
    annotationText: text(row, 3),
  }));
}
async function getEmbeddingMetadata(driver, revision, slug) {
  const result = await execute(driver, `
DECLARE $revision AS Utf8;
DECLARE $slug AS Utf8;
SELECT source_hash, dimensions FROM ${EMBEDDINGS_TABLE}
WHERE model_revision = $revision AND pet_slug = $slug LIMIT 1;
  `, { $revision: TypedValues.utf8(revision), $slug: TypedValues.utf8(slug) });
  const row = rows(result)[0];
  return row
    ? { sourceHash: text(row, 0), dimensions: Number(row.items?.[1]?.uint32Value ?? 0) }
    : null;
}
async function upsertEmbedding(driver, input) {
  await execute(driver, `
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
function execute(driver, statement, params = {}) {
  return driver.tableClient.withSessionRetry(
    (session) => session.executeQuery(statement, params),
    10_000,
    3,
  );
}
function rows(result) { return result?.resultSets?.[0]?.rows ?? []; }
function text(row, index) { return row.items?.[index]?.textValue ?? ""; }
function isLocalEndpoint(value) {
  try {
    return ["localhost", "127.0.0.1", "::1", "ydb-local"].includes(
      new URL(value).hostname,
    );
  } catch { return false; }
}

const invokedAsScript = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Backfill failed.");
    process.exitCode = 1;
  });
}
