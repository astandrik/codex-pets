#!/usr/bin/env node
import {
  mkdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  createBlindCaptionReviewArtifact,
  selectEligibleCaptionRevisions,
} from "./lib/pet-caption-bakeoff.mjs";
import {
  extractPetVisionFrames,
  parsePetDerivedVisionCaptionEnvelope,
  parsePetVisionCaptionEnvelope,
} from "./lib/pet-vision-search-backfill.mjs";

const require = createRequire(import.meta.url);
const {
  Driver,
  StaticCredentialsAuthService,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = require("ydb-sdk");

const QWEN_REVISION =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1";
const DEEPSEEK_REVISION =
  "yandex-qwen3.6-35b-a3b-deepseek-v4-flash-pet-caption-2026-07-v1";
const OUTPUT_DIRECTORY = resolve(
  process.cwd(),
  ".scratch/pet-caption-bakeoff",
);
const PREFLIGHT_RESULT = resolve(
  process.cwd(),
  ".scratch/pet-search-v2-preflight.json",
);

export async function main() {
  const candidateRevisions = readEligibleCandidateRevisions();
  if (await pathExists(OUTPUT_DIRECTORY)) {
    throw new Error(
      ".scratch/pet-caption-bakeoff already exists; preserve or remove it explicitly.",
    );
  }
  const temporaryDirectory =
    `${OUTPUT_DIRECTORY}.tmp-${process.pid}`;
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
    const pets = await listApprovedPets(driver);
    const artifactPets = [];
    await mkdir(join(temporaryDirectory, "frames"), {
      recursive: true,
      mode: 0o700,
    });

    for (const [index, pet] of pets.entries()) {
      const captions = {};
      for (const revision of candidateRevisions) {
        const row = await getCaption(driver, revision, pet.slug);
        if (!row) continue;
        try {
          captions[revision] =
            revision === DEEPSEEK_REVISION
              ? parsePetDerivedVisionCaptionEnvelope(row.captionJson).caption
              : parsePetVisionCaptionEnvelope(row.captionJson).caption;
        } catch {
          continue;
        }
      }
      const spritesheet = await readSpritesheet(driver, pet.assetId);
      const extracted = await extractPetVisionFrames(spritesheet);
      const frameFiles = [];
      for (const frame of extracted.frames) {
        const filename =
          `frames/pet-${String(index + 1).padStart(3, "0")}-${frame.state}.png`;
        await writeFile(join(temporaryDirectory, filename), frame.png, {
          mode: 0o600,
        });
        frameFiles.push(filename);
      }
      artifactPets.push({
        slug: pet.slug,
        frameFiles,
        captions,
      });
    }

    const artifact = createBlindCaptionReviewArtifact({
      candidateRevisions,
      pets: artifactPets,
    });
    await writeFile(
      join(temporaryDirectory, "review.json"),
      `${JSON.stringify(artifact.review, null, 2)}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      join(temporaryDirectory, ".candidate-key.json"),
      `${JSON.stringify(artifact.key, null, 2)}\n`,
      { mode: 0o600 },
    );
    await rename(temporaryDirectory, OUTPUT_DIRECTORY);
    console.log(
      JSON.stringify({
        approvedPets: pets.length,
        candidates: artifact.key.items[0]?.candidates.length ?? 0,
        output: ".scratch/pet-caption-bakeoff",
      }),
    );
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  } finally {
    await driver.destroy();
  }
}

function readEligibleCandidateRevisions() {
  let result;
  try {
    result = JSON.parse(readFileSync(PREFLIGHT_RESULT, "utf8"));
  } catch {
    throw new Error(
      "Run search:preflight-v2 before building the caption bakeoff.",
    );
  }
  return selectEligibleCaptionRevisions(
    result,
    QWEN_REVISION,
    DEEPSEEK_REVISION,
  );
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
  });
}

function createAuthService(endpoint) {
  const user = process.env.YDB_STATIC_CREDENTIALS_USER?.trim();
  if (!user) return getCredentialsFromEnv();
  const passwordFile =
    process.env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  const password = passwordFile
    ? readFileSync(passwordFile, "utf8").replace(/[\r\n]+$/, "")
    : process.env.YDB_STATIC_CREDENTIALS_PASSWORD?.trim();
  if (!password) {
    throw new Error(
      "YDB_STATIC_CREDENTIALS_USER requires a password or password file.",
    );
  }
  return new StaticCredentialsAuthService(
    user,
    password,
    process.env.YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT?.trim() || endpoint,
    getDefaultLogger(),
  );
}

async function listApprovedPets(driver) {
  const result = await execute(
    driver,
    `
DECLARE $status AS Utf8;

SELECT slug, spritesheet_url
FROM codex_pets
WHERE status = $status
ORDER BY slug;
    `,
    { $status: TypedValues.utf8("approved") },
  );
  return rowsFromResult(result).map((row) => {
    const slug = textAt(row, 0);
    const spritesheetUrl = textAt(row, 1);
    const assetId = petAssetId(spritesheetUrl);
    if (!assetId) {
      throw new Error(`Approved pet ${slug} has an invalid asset URL.`);
    }
    return { slug, assetId };
  });
}

async function getCaption(driver, captionRevision, slug) {
  const result = await execute(
    driver,
    `
DECLARE $caption_revision AS Utf8;
DECLARE $pet_slug AS Utf8;

SELECT caption_json
FROM codex_pet_search_captions
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
  return row ? { captionJson: textAt(row, 0) } : null;
}

async function readSpritesheet(driver, assetId) {
  const result = await execute(
    driver,
    `
DECLARE $asset_id AS Utf8;

SELECT spritesheet_bytes
FROM codex_pet_assets
WHERE asset_id = $asset_id
LIMIT 1;
    `,
    { $asset_id: TypedValues.utf8(assetId) },
  );
  const row = rowsFromResult(result)[0];
  if (!row) throw new Error("Approved pet asset is missing.");
  const value = row.items?.[0]?.bytesValue;
  return Buffer.isBuffer(value) ? value : Buffer.from(value ?? []);
}

function execute(driver, statement, params) {
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

function petAssetId(value) {
  const match = value.match(
    /\/api\/assets\/([^/]+)\/spritesheet\.(?:webp|png)$/,
  );
  return match ? decodeURIComponent(match[1]) : null;
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

async function pathExists(path) {
  try {
    await stat(path);
    return true;
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
      error instanceof Error ? error.message : "Bakeoff artifact failed.",
    );
    process.exitCode = 1;
  });
}
