#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import {
  buildRelatedPetQuery,
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

const require = createRequire(import.meta.url);
const {
  Driver,
  StaticCredentialsAuthService,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = require("ydb-sdk");

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

  const endpoint =
    process.env.YDB_PETS_ENDPOINT?.trim() || "grpc://127.0.0.1:2136";
  const database = process.env.YDB_PETS_DATABASE?.trim() || "/local";
  if (isLocalEndpoint(endpoint)) {
    process.env.YDB_ANONYMOUS_CREDENTIALS ??= "1";
    process.env.YDB_ENDPOINT ??= endpoint;
  }

  const driver = createDriver(endpoint, database);
  try {
    const ready = await driver.ready(15_000);
    if (!ready) {
      throw new Error(`YDB driver is not ready for ${endpoint} ${database}.`);
    }

    const embedDocument = options.mode === "apply"
      ? createEmbeddingProvider(
          readEmbeddingProviderConfig(),
          revisionDefinition,
        )
      : async () => {
          throw new Error("Dry-run must not call the embedding provider.");
        };
    const pets = await listApprovedPets(driver);
    return await runPetSearchBackfill({
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
            buildInput: buildRelatedPetQuery,
            createSourceHash: createRelatedPetQuerySourceHash,
          }
        : {}),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  } finally {
    await driver.destroy();
  }
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
    poolSettings: {
      minLimit: 1,
      maxLimit: 4,
      keepAlivePeriod: 30_000,
    },
  });
}

function createAuthService(endpoint) {
  const user = process.env.YDB_STATIC_CREDENTIALS_USER?.trim();
  if (!user) return getCredentialsFromEnv();

  const password = readYdbPassword();
  if (!password) {
    throw new Error(
      "YDB_STATIC_CREDENTIALS_USER is set, but no password or password file was provided.",
    );
  }

  return new StaticCredentialsAuthService(
    user,
    password,
    process.env.YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT?.trim() || endpoint,
    getDefaultLogger(),
  );
}

function readYdbPassword() {
  const file = process.env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  if (file) return readFileSync(file, "utf8").replace(/[\r\n]+$/, "");
  return process.env.YDB_STATIC_CREDENTIALS_PASSWORD?.trim() || undefined;
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
  const result = await execute(
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
    tags: parseTags(textAt(row, 4)),
    status: "approved",
  }));
}

async function getEmbeddingMetadata(driver, modelRevision, slug) {
  const result = await execute(
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
    ? { sourceHash: textAt(row, 0), dimensions: uintAt(row, 1) }
    : null;
}

async function upsertEmbedding(driver, input) {
  await execute(
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

function execute(driver, statement, params = {}) {
  return driver.tableClient.withSessionRetry(
    (session) => session.executeQuery(statement, params),
    10_000,
    3,
  );
}

function rowsFromResult(result) {
  return result?.resultSets?.[0]?.rows ?? [];
}

function textAt(row, index) {
  return row.items?.[index]?.textValue ?? "";
}

function uintAt(row, index) {
  const value = row.items?.[index]?.uint32Value;
  return typeof value === "number" ? value : Number(value ?? 0);
}

function parseTags(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag) => typeof tag === "string")
      : [];
  } catch {
    return [];
  }
}

function isLocalEndpoint(value) {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "ydb-local"].includes(
      parsed.hostname,
    );
  } catch {
    return false;
  }
}

const invokedAsScript = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Backfill failed.");
    process.exitCode = 1;
  });
}
