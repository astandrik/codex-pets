#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  RELATED_PETS_ANNOTATION_MODEL_NAME,
  RELATED_PETS_ANNOTATION_REVISION,
  createRelatedPetAnnotationSourceHash,
} from "../src/lib/pets/related-pets-annotation-contract.mjs";
import { createYandexRelatedPetAnnotationClient } from "../src/lib/pets/related-pets-annotation-client.mjs";
import {
  parseRelatedPetAnnotationBackfillArgs,
  runRelatedPetAnnotationBackfill,
} from "./lib/related-pets-annotation-backfill.mjs";
import {
  TypedValues,
  executeYdbQuery,
  parseStringArray,
  rowsFromResult,
  textAt,
  withYdbCliDriver,
} from "./lib/ydb-cli.mjs";

const PETS_TABLE = "codex_pets";
const ANNOTATIONS_TABLE = "codex_pet_related_annotations";
const DEFAULT_TIMEOUT_MS = 180_000;

export async function main(argv = process.argv.slice(2)) {
  const options = parseRelatedPetAnnotationBackfillArgs(argv);

  return withYdbCliDriver(async (driver) => {
    const provider = readProviderConfig(options.mode);
    const modelUri =
      `gpt://${provider.folderId}/${RELATED_PETS_ANNOTATION_MODEL_NAME}`;
    let createProposal;
    if (options.mode !== "apply") {
      createProposal = async () => {
        throw new Error("Dry-run must not load an annotation proposal.");
      };
    } else {
      createProposal = createYandexRelatedPetAnnotationClient({
        folderId: provider.folderId,
        apiKey: provider.apiKey,
        modelUri,
        timeoutMs: provider.timeoutMs,
        onDiagnostic: (entry) => console.log(JSON.stringify({
          action: "provider-diagnostic",
          ...entry,
        })),
      }).createProposal;
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
  }, { requireExplicitTarget: options.mode === "apply" });
}

function readProviderConfig(mode) {
  const folderId = process.env.YANDEX_AI_STUDIO_FOLDER_ID?.trim();
  if (!folderId) throw new Error("YANDEX_AI_STUDIO_FOLDER_ID is required.");
  let apiKey = "";
  if (mode === "apply") {
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

async function listApprovedPets(driver) {
  const result = await executeYdbQuery(driver, `
DECLARE $status AS Utf8;
SELECT slug, display_name, description, kind, tags_json
FROM ${PETS_TABLE}
WHERE status = $status
ORDER BY created_at DESC;
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

async function getAnnotation(driver, revision, slug) {
  const result = await executeYdbQuery(driver, `
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
  const row = rowsFromResult(result)[0];
  return row
    ? { sourceHash: textAt(row, 0), proposalJson: textAt(row, 1) }
    : null;
}

function upsertAnnotation(driver, input) {
  return executeYdbQuery(driver, `
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

const invokedAsScript = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Backfill failed.");
    process.exitCode = 1;
  });
}
