#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  RELATED_PETS_ANNOTATION_MODEL_NAME,
  RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
  RELATED_PETS_ANNOTATION_SCHEMA_NAME,
  RELATED_PETS_ANNOTATION_REVISION,
  RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
  RELATED_PETS_ANNOTATION_USER_PROMPT,
  buildRelatedPetAnnotationInput,
  createRelatedPetAnnotationSourceHash,
  parseRelatedPetAnnotationProposal,
} from "../src/lib/pets/related-pets-annotation-contract.mjs";
import {
  createResponsesStructuredRequester,
} from "../src/lib/pets/responses-structured-provider.mjs";
import {
  createStoredRelatedPetAnnotationProposalLoader,
  parseRelatedPetAnnotationBackfillArgs,
  runRelatedPetAnnotationBackfill,
} from "./lib/related-pets-annotation-backfill.mjs";

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
const DEFAULT_TIMEOUT_MS = 180_000;

export async function main(argv = process.argv.slice(2)) {
  const options = parseRelatedPetAnnotationBackfillArgs(argv);
  if (options.reuseProposalsFrom === RELATED_PETS_ANNOTATION_REVISION) {
    throw new Error("Source and target annotation revisions must differ.");
  }
  const providerConfig = readProviderConfig(
    options.mode,
    !options.reuseProposalsFrom,
  );
  const modelUri =
    `gpt://${providerConfig.folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`;
  const endpoint =
    process.env.YDB_PETS_ENDPOINT?.trim() || "grpc://127.0.0.1:2136";
  const database = process.env.YDB_PETS_DATABASE?.trim() || "/local";
  if (isLocalEndpoint(endpoint)) {
    process.env.YDB_ANONYMOUS_CREDENTIALS ??= "1";
    process.env.YDB_ENDPOINT ??= endpoint;
  }

  const driver = createDriver(endpoint, database);
  try {
    if (!(await driver.ready(15_000))) {
      throw new Error(`YDB driver is not ready for ${endpoint} ${database}.`);
    }
    let createProposal;
    if (options.mode !== "apply") {
      createProposal = async () => {
        throw new Error("Dry-run must not load an annotation proposal.");
      };
    } else if (options.reuseProposalsFrom) {
      createProposal = createStoredRelatedPetAnnotationProposalLoader({
        sourceRevision: options.reuseProposalsFrom,
        getAnnotation: (revision, slug) => getAnnotation(driver, revision, slug),
      });
    } else {
      createProposal = createResponsesStructuredRequester({
        folderId: providerConfig.folderId,
        apiKey: providerConfig.apiKey,
        modelUri,
        timeoutMs: providerConfig.timeoutMs,
        systemPrompt: RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
        responseSchemaName: RELATED_PETS_ANNOTATION_SCHEMA_NAME,
        responseJsonSchema: RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
        buildContent: (pet) => [{
          type: "input_text",
          text: [
            RELATED_PETS_ANNOTATION_USER_PROMPT,
            buildRelatedPetAnnotationInput(pet),
          ].join("\n\n"),
        }],
        parseValue: parseRelatedPetAnnotationProposal,
        onDiagnostic: (entry) =>
          console.log(JSON.stringify({
            action: "provider-diagnostic",
            ...entry,
          })),
      });
    }
    const summary = await runRelatedPetAnnotationBackfill({
      options,
      annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
      modelUri,
      pets: await listApprovedPets(driver),
      getAnnotation: (revision, slug) => getAnnotation(driver, revision, slug),
      createProposal,
      upsertAnnotation: (input) => upsertAnnotation(driver, input),
      createSourceHash: createRelatedPetAnnotationSourceHash,
      log: (entry) => console.log(JSON.stringify(entry)),
    });
    if (summary.failed > 0) process.exitCode = 1;
    return summary;
  } finally {
    await driver.destroy();
  }
}

function readProviderConfig(mode, needsApiKey) {
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  if (!folderId) {
    throw new Error("YANDEX_AI_STUDIO_FOLDER_ID is required.");
  }
  let apiKey = "";
  if (mode === "apply" && needsApiKey) {
    const file = process.env.YANDEX_AI_STUDIO_API_KEY_FILE?.trim();
    if (!file) {
      throw new Error("--apply requires YANDEX_AI_STUDIO_API_KEY_FILE.");
    }
    apiKey = readFileSync(file, "utf8").trim();
    if (!apiKey) throw new Error("YANDEX_AI_STUDIO_API_KEY_FILE is empty.");
  }
  const rawTimeout = Number(process.env.PET_RELATED_ANNOTATION_TIMEOUT_MS);
  const timeoutMs = Number.isInteger(rawTimeout) &&
      rawTimeout >= 1_000 && rawTimeout <= 300_000
    ? rawTimeout
    : DEFAULT_TIMEOUT_MS;
  return { folderId, apiKey, timeoutMs };
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
SELECT slug, display_name, description, kind, tags_json
FROM ${PETS_TABLE}
WHERE status = $status
ORDER BY created_at DESC;
  `, { $status: TypedValues.utf8("approved") });
  return rows(result).map((row) => ({
    slug: text(row, 0),
    displayName: text(row, 1),
    description: text(row, 2),
    kind: text(row, 3),
    tags: parseTags(text(row, 4)),
    status: "approved",
  }));
}

async function getAnnotation(driver, revision, slug) {
  const result = await execute(driver, `
DECLARE $revision AS Utf8;
DECLARE $slug AS Utf8;
SELECT source_hash, proposal_json
FROM ${ANNOTATIONS_TABLE}
WHERE annotation_revision = $revision AND pet_slug = $slug
LIMIT 1;
  `, {
    $revision: TypedValues.utf8(revision),
    $slug: TypedValues.utf8(slug),
  });
  const row = rows(result)[0];
  return row
    ? { sourceHash: text(row, 0), proposalJson: text(row, 1) }
    : null;
}

async function upsertAnnotation(driver, input) {
  await execute(driver, `
DECLARE $revision AS Utf8;
DECLARE $slug AS Utf8;
DECLARE $source_hash AS Utf8;
DECLARE $proposal_json AS Utf8;
DECLARE $annotation_json AS Utf8;
DECLARE $annotation_text AS Utf8;
DECLARE $updated_at AS Utf8;
UPSERT INTO ${ANNOTATIONS_TABLE}
(annotation_revision, pet_slug, source_hash, proposal_json, annotation_json,
 annotation_text, updated_at)
VALUES ($revision, $slug, $source_hash, $proposal_json, $annotation_json,
        $annotation_text, $updated_at);
  `, {
    $revision: TypedValues.utf8(input.annotationRevision),
    $slug: TypedValues.utf8(input.slug),
    $source_hash: TypedValues.utf8(input.sourceHash),
    $proposal_json: TypedValues.utf8(input.proposalJson),
    $annotation_json: TypedValues.utf8(input.annotationJson),
    $annotation_text: TypedValues.utf8(input.annotationText),
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
function parseTags(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((tag) => typeof tag === "string")
      : [];
  } catch { return []; }
}
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
