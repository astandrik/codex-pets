#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { createRequestStartLimiter } from "./lib/pet-search-backfill.mjs";
import {
  PET_VISION_CAPTION_REVISION_V1,
  PET_VISUAL_MODEL_REVISION_V1,
  assertPetVisionBackfillInvocationPolicy,
  embeddingToBuffer,
  extractPetVisionFrames,
  parsePetVisionCaption,
  parseVisionBackfillArgs,
  resolvePetVisionRevisionConfig,
  runPetVisionSearchBackfill,
} from "./lib/pet-vision-search-backfill.mjs";

const require = createRequire(import.meta.url);
const {
  Driver,
  StaticCredentialsAuthService,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = require("ydb-sdk");

const PETS_TABLE = "codex_pets";
const ASSETS_TABLE = "codex_pet_assets";
const CAPTIONS_TABLE = "codex_pet_search_captions";
const EMBEDDINGS_TABLE = "codex_pet_search_embeddings";
const CAPTION_REVISION = PET_VISION_CAPTION_REVISION_V1;
const VISUAL_REVISION = PET_VISUAL_MODEL_REVISION_V1;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 800;
const DEFAULT_VISION_TIMEOUT_MS = 30_000;
const VISION_ENDPOINT =
  "https://ai.api.cloud.yandex.net/v1/chat/completions";
const EMBEDDING_ENDPOINT =
  "https://ai.api.cloud.yandex.net/foundationModels/v1/textEmbedding";

export async function main(argv = process.argv.slice(2)) {
  const options = parseVisionBackfillArgs(argv);
  const revisionSelection = preflightPetVisionBackfillInvocation(
    options,
    process.env,
  );
  const providerConfig = readProviderConfig(
    options.mode,
    revisionSelection,
  );
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

    const applyProviders = options.mode === "apply"
      ? {
          createCaption: createVisionProvider(providerConfig),
          embedDocument: createEmbeddingProvider(providerConfig),
        }
      : {
          createCaption: async () => {
            throw new Error("Dry-run must not call the vision provider.");
          },
          embedDocument: async () => {
            throw new Error("Dry-run must not call the embedding provider.");
          },
        };
    const pets = await listApprovedPets(driver);
    return await runPetVisionSearchBackfill({
      options,
      config: {
        captionRevision: providerConfig.captionRevision,
        visualRevision: providerConfig.visualRevision,
        dimensions: providerConfig.dimensions,
        modelUri: providerConfig.modelUri,
      },
      pets,
      listApprovedPets: () => listApprovedPets(driver),
      readSpritesheet: (assetId) => readSpritesheet(driver, assetId),
      extractFrames: extractPetVisionFrames,
      getCaption: (captionRevision, slug) =>
        getCaption(driver, captionRevision, slug),
      getEmbeddingMetadata: (modelRevision, slug) =>
        getEmbeddingMetadata(driver, modelRevision, slug),
      createCaption: applyProviders.createCaption,
      embedDocument: applyProviders.embedDocument,
      upsertCaption: (input) => upsertCaption(driver, input),
      upsertEmbedding: (input) => upsertEmbedding(driver, input),
      now: () => new Date(),
      log: (entry) => console.log(JSON.stringify(entry)),
    });
  } finally {
    await driver.destroy();
  }
}

export function preflightPetVisionBackfillInvocation(
  options,
  environment,
) {
  const captionRevision =
    environment.PET_SEARCH_VISION_CAPTION_REVISION?.trim() ||
    CAPTION_REVISION;
  const visualRevision =
    environment.PET_SEARCH_VISUAL_MODEL_REVISION?.trim() ||
    VISUAL_REVISION;
  const revisionSelection = resolvePetVisionRevisionConfig(
    captionRevision,
    visualRevision,
  );
  assertPetVisionBackfillInvocationPolicy(options, revisionSelection);
  return revisionSelection;
}

function readProviderConfig(mode, revisionConfig) {
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  if (!folderId) {
    throw new Error("YANDEX_AI_STUDIO_FOLDER_ID is required.");
  }
  const modelUri =
    `gpt://${folderId}/${revisionConfig.captionContract.modelName}`;
  if (mode === "dry-run") {
    return {
      ...revisionConfig,
      folderId,
      apiKey: "",
      modelUri,
      embeddingTimeoutMs: DEFAULT_EMBEDDING_TIMEOUT_MS,
      visionTimeoutMs: DEFAULT_VISION_TIMEOUT_MS,
    };
  }

  const apiKeyFile =
    process.env.YANDEX_AI_STUDIO_API_KEY_FILE?.trim();
  if (!apiKeyFile) {
    throw new Error(
      "--apply requires YANDEX_AI_STUDIO_API_KEY_FILE.",
    );
  }
  const apiKey = readFileSync(apiKeyFile, "utf8").trim();
  if (!apiKey) {
    throw new Error("YANDEX_AI_STUDIO_API_KEY_FILE is empty.");
  }
  return {
    ...revisionConfig,
    folderId,
    apiKey,
    modelUri,
    embeddingTimeoutMs: boundedTimeout(
      process.env.PET_SEARCH_EMBEDDING_TIMEOUT_MS,
      DEFAULT_EMBEDDING_TIMEOUT_MS,
      50,
      5_000,
    ),
    visionTimeoutMs: boundedTimeout(
      process.env.PET_SEARCH_VISION_TIMEOUT_MS,
      DEFAULT_VISION_TIMEOUT_MS,
      1_000,
      60_000,
    ),
  };
}

function createVisionProvider(config) {
  const reserveStart = createRequestStartLimiter({
    requestsPerMinute: 10,
    sleep: delay,
  });

  return async function createCaption(frames) {
    let response = await request();
    if (response.status === 429 || response.status >= 500) {
      const retryDelay = retryAfterMs(
        response.headers.get("Retry-After"),
      );
      if (retryDelay > 0) await delay(retryDelay);
      response = await request();
    }
    if (!response.ok) {
      throw providerError(httpFailureReason(response.status));
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw providerError("invalid_response");
    }
    const choices = payload?.choices;
    const message =
      Array.isArray(choices) && choices.length === 1
        ? choices[0]?.message
        : null;
    if (
      message &&
      typeof message === "object" &&
      typeof message.refusal === "string"
    ) {
      throw providerError("refused");
    }
    if (
      !message ||
      typeof message !== "object" ||
      typeof message.content !== "string"
    ) {
      throw providerError("invalid_response");
    }
    try {
      return parsePetVisionCaption(
        config.captionRevision,
        JSON.parse(message.content),
      );
    } catch {
      throw providerError("invalid_response");
    }

    async function request() {
      await reserveStart();
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.visionTimeoutMs,
      );
      try {
        return await fetch(VISION_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Api-Key ${config.apiKey}`,
            "Content-Type": "application/json",
            "OpenAI-Project": config.folderId,
          },
          body: JSON.stringify({
          model: config.modelUri,
          messages: [
              {
                role: "system",
                content: config.captionContract.systemPrompt,
              },
              {
                role: "user",
                content: [
                  {
                    type: "text",
                    text: config.captionContract.userPrompt,
                  },
                  ...frames.map((frame) => ({
                    type: "image_url",
                    image_url: { url: frame.dataUrl },
                  })),
                ],
              },
            ],
            temperature: 0,
            stream: false,
            max_tokens: config.captionContract.maxTokens,
            response_format: {
              type: "json_schema",
              json_schema: {
                name: config.captionContract.responseSchemaName,
                strict: true,
                schema: config.captionContract.responseJsonSchema,
              },
            },
          }),
          signal: controller.signal,
        });
      } catch {
        throw providerError(
          controller.signal.aborted ? "timeout" : "provider_error",
        );
      } finally {
        clearTimeout(timeout);
      }
    }
  };
}

function createEmbeddingProvider(config) {
  const reserveStart = createRequestStartLimiter({
    requestsPerMinute: 60,
    sleep: delay,
  });

  return async function embedDocument(text) {
    await reserveStart();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.embeddingTimeoutMs,
    );
    try {
      const response = await fetch(EMBEDDING_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Api-Key ${config.apiKey}`,
          "Content-Type": "application/json",
          "x-folder-id": config.folderId,
        },
        body: JSON.stringify({
          modelUri: `emb://${config.folderId}/text-search-doc/latest`,
          text,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw providerError(httpFailureReason(response.status));
      }
      const payload = await response.json();
      if (!Array.isArray(payload?.embedding)) {
        throw providerError("invalid_response");
      }
      return payload.embedding;
    } catch (error) {
      if (error?.reason) throw error;
      throw providerError(
        controller.signal.aborted ? "timeout" : "provider_error",
      );
    } finally {
      clearTimeout(timeout);
    }
  };
}

function providerError(reason) {
  return Object.assign(new Error("AI provider request failed."), {
    reason,
  });
}

function httpFailureReason(status) {
  if (status === 401 || status === 403) return "authentication_error";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500) return "invalid_request";
  return "provider_error";
}

function retryAfterMs(value) {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(10_000, Math.ceil(seconds * 1_000));
  }
  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.min(10_000, Math.max(0, date - Date.now()))
    : 0;
}

function createDriver(endpoint, database) {
  return new Driver({
    endpoint,
    database,
    authService: createAuthService(endpoint),
    clientOptions: {
      "grpc.max_receive_message_length": 64 * 1024 * 1024,
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
  const file =
    process.env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  if (file) return readFileSync(file, "utf8").replace(/[\r\n]+$/, "");
  return process.env.YDB_STATIC_CREDENTIALS_PASSWORD?.trim() || undefined;
}

async function listApprovedPets(driver) {
  const result = await execute(
    driver,
    `
DECLARE $status AS Utf8;

SELECT slug, spritesheet_url
FROM ${PETS_TABLE}
WHERE status = $status
ORDER BY created_at DESC;
    `,
    { $status: TypedValues.utf8("approved") },
  );
  return rowsFromResult(result).map((row) => ({
    slug: textAt(row, 0),
    spritesheetUrl: textAt(row, 1),
    status: "approved",
  }));
}

async function readSpritesheet(driver, assetId) {
  const result = await execute(
    driver,
    `
DECLARE $asset_id AS Utf8;

SELECT spritesheet_bytes
FROM ${ASSETS_TABLE}
WHERE asset_id = $asset_id
LIMIT 1;
    `,
    { $asset_id: TypedValues.utf8(assetId) },
  );
  const row = rowsFromResult(result)[0];
  if (!row) throw new Error("Asset not found.");
  return bytesAt(row, 0);
}

async function getCaption(driver, captionRevision, slug) {
  const result = await execute(
    driver,
    `
DECLARE $caption_revision AS Utf8;
DECLARE $pet_slug AS Utf8;

SELECT pet_slug, source_hash, caption_json, caption_text, updated_at
FROM ${CAPTIONS_TABLE}
WHERE caption_revision = $caption_revision
  AND pet_slug = $pet_slug
LIMIT 1;
    `,
    {
      $caption_revision: TypedValues.utf8(captionRevision),
      $pet_slug: TypedValues.utf8(slug),
    },
  );
  const row = rowsFromResult(result)[0];
  return row
    ? {
        slug: textAt(row, 0),
        sourceHash: textAt(row, 1),
        captionJson: textAt(row, 2),
        captionText: textAt(row, 3),
        updatedAt: textAt(row, 4),
      }
    : null;
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

async function upsertCaption(driver, input) {
  await execute(
    driver,
    `
DECLARE $caption_revision AS Utf8;
DECLARE $pet_slug AS Utf8;
DECLARE $source_hash AS Utf8;
DECLARE $caption_json AS Utf8;
DECLARE $caption_text AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${CAPTIONS_TABLE}
(caption_revision, pet_slug, source_hash, caption_json, caption_text, updated_at)
VALUES
($caption_revision, $pet_slug, $source_hash, $caption_json, $caption_text, $updated_at);
    `,
    {
      $caption_revision: TypedValues.utf8(input.captionRevision),
      $pet_slug: TypedValues.utf8(input.slug),
      $source_hash: TypedValues.utf8(input.sourceHash),
      $caption_json: TypedValues.utf8(input.captionJson),
      $caption_text: TypedValues.utf8(input.captionText),
      $updated_at: TypedValues.utf8(input.updatedAt),
    },
  );
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

function bytesAt(row, index) {
  const value = row.items?.[index]?.bytesValue;
  if (!value) return Buffer.alloc(0);
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

function boundedTimeout(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
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

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(
      error?.reason
        ? `Vision backfill failed: ${error.reason}.`
        : error instanceof Error
          ? error.message
          : "Vision backfill failed.",
    );
    process.exitCode = 1;
  });
}
