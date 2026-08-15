#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import {
  assertAllDescriptionsChanged,
  assertAllSlugsFound,
  buildEmbeddingBackfillCommands,
  parseUpdateArgs,
  readDescriptionUpdates,
} from "./lib/pet-description-update.mjs";
import {
  RELATED_PETS_REBUILD_COMMANDS,
  buildRelatedPetsTextBackfillCommands,
} from "./lib/related-pets-maintenance.mjs";

const require = createRequire(import.meta.url);
const {
  Driver,
  StaticCredentialsAuthService,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = require("ydb-sdk");

const PETS_TABLE = "codex_pets";
const BACKUP_DIR = new URL("../.scratch/", import.meta.url);

export async function main(argv = process.argv.slice(2)) {
  const options = parseUpdateArgs(argv);
  const updates = readDescriptionUpdates(options.file);

  if (!options.apply) {
    console.log(
      `dry-run: ${updates.length} description update(s) from ${options.file}`,
    );
    for (const update of updates) {
      console.log(
        `plan ${update.slug} (${update.description.length} chars): ${update.description}`,
      );
    }
    console.log("dry-run only; rerun with --apply to write these changes.");
    return;
  }

  const endpoint = process.env.YDB_PETS_ENDPOINT?.trim();
  const database = process.env.YDB_PETS_DATABASE?.trim();
  if (!endpoint || !database) {
    throw new Error(
      "--apply requires explicit YDB_PETS_ENDPOINT and YDB_PETS_DATABASE; no local topology is assumed.",
    );
  }
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

    const currentPets = await listCurrentDescriptions(
      driver,
      updates.map((update) => update.slug),
    );
    assertAllSlugsFound(updates, currentPets);
    assertAllDescriptionsChanged(updates, currentPets);

    const backupPath = writeBackup(currentPets);
    console.log(`backup of previous descriptions: ${backupPath}`);

    const now = new Date().toISOString();
    await applyDescriptionUpdates(driver, updates, now);
    for (const update of updates) {
      console.log(`applied ${update.slug}`);
    }
    console.log(`applied ${updates.length} description update(s).`);
    console.log(
      "refresh the search embeddings for the rewritten description(s):",
    );
    for (const command of buildEmbeddingBackfillCommands(
      updates.map((update) => update.slug),
    )) {
      console.log(command);
    }
    console.log(
      "refresh both related embedding roles for the rewritten description(s):",
    );
    for (const command of buildRelatedPetsTextBackfillCommands(
      updates.map((update) => update.slug),
    )) {
      console.log(command);
    }
    console.log(
      "after all document and related-query backfills succeed, refresh related-pet snapshots:",
    );
    for (const command of RELATED_PETS_REBUILD_COMMANDS) {
      console.log(command);
    }
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

async function listCurrentDescriptions(driver, slugs) {
  const { statement, params } = buildSelectBySlugs(slugs);
  const result = await execute(driver, statement, params);
  return mapPetRows(result);
}

function buildSelectBySlugs(slugs) {
  const declarations = slugs
    .map((_, index) => `DECLARE $slug${index} AS Utf8;`)
    .join("\n");
  const predicate = slugs
    .map((_, index) => `slug = $slug${index}`)
    .join(" OR ");
  const params = Object.fromEntries(
    slugs.map((slug, index) => [`$slug${index}`, TypedValues.utf8(slug)]),
  );

  return {
    statement: `
${declarations}

SELECT slug, description, status
FROM ${PETS_TABLE}
WHERE ${predicate};
    `,
    params,
  };
}

function mapPetRows(result) {
  return new Map(
    rowsFromResult(result).map((row) => [
      textAt(row, 0),
      { description: textAt(row, 1), status: textAt(row, 2) },
    ]),
  );
}

function writeBackup(currentPets) {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = new URL(
    `pet-descriptions-backup-${timestamp}.json`,
    BACKUP_DIR,
  );
  const previousDescriptions = Object.fromEntries(
    Array.from(currentPets, ([slug, pet]) => [slug, pet.description]),
  );
  writeFileSync(
    backupPath,
    `${JSON.stringify(previousDescriptions, null, 2)}\n`,
  );
  return backupPath.pathname;
}

async function applyDescriptionUpdates(driver, updates, now) {
  await driver.tableClient.withSessionRetry(
    async (session) => {
      const tx = await session.beginTransaction({ serializableReadWrite: {} });
      if (!tx.id) {
        throw new Error("Unable to start YDB transaction.");
      }
      const txControl = { txId: tx.id };

      try {
        // Re-read and re-validate statuses inside the serializable
        // transaction: moderation may have rejected or deleted a pet
        // after the preflight read.
        const currentInTx = await readPetsBySlugs(
          session,
          updates.map((update) => update.slug),
          txControl,
        );
        assertAllSlugsFound(updates, currentInTx);

        for (const update of updates) {
          await session.executeQuery(
            `
DECLARE $slug AS Utf8;
DECLARE $description AS Utf8;
DECLARE $updated_at AS Utf8;

UPDATE ${PETS_TABLE}
SET description = $description,
    updated_at = $updated_at
WHERE slug = $slug;
            `,
            {
              $slug: TypedValues.utf8(update.slug),
              $description: TypedValues.utf8(update.description),
              $updated_at: TypedValues.utf8(now),
            },
            txControl,
          );
        }
        await session.commitTransaction(txControl);
      } catch (error) {
        try {
          await session.rollbackTransaction(txControl);
        } catch {
          // The transaction may already be aborted or committed by YDB.
        }
        throw error;
      }
    },
    10_000,
    3,
  );
}

async function readPetsBySlugs(session, slugs, txControl) {
  const { statement, params } = buildSelectBySlugs(slugs);
  const result = await session.executeQuery(statement, params, txControl);
  return mapPetRows(result);
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
    console.error(
      error instanceof Error ? error.message : "Description update failed.",
    );
    process.exitCode = 1;
  });
}
