#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";

const require = createRequire(import.meta.url);
const {
  AlterTableDescription,
  Column,
  Driver,
  StaticCredentialsAuthService,
  TableDescription,
  Types,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = require("ydb-sdk");

const MIGRATIONS_TABLE = "codex_schema_migrations";
const MIGRATIONS_DIR = new URL("../ydb/migrations/", import.meta.url);

const endpoint = process.env.YDB_PETS_ENDPOINT?.trim() || "grpc://127.0.0.1:2136";
const database = process.env.YDB_PETS_DATABASE?.trim() || "/local";

if (isLocalEndpoint(endpoint)) {
  process.env.YDB_ANONYMOUS_CREDENTIALS ??= "1";
  process.env.YDB_ENDPOINT ??= endpoint;
}

async function main() {
  const driver = createDriver();
  try {
    const ready = await driver.ready(15_000);
    if (!ready) {
      throw new Error(`YDB driver is not ready for ${endpoint} ${database}.`);
    }

    await ensureMigrationsTable(driver);
    const appliedIds = await readAppliedMigrationIds(driver);
    const migrations = await readMigrations();

    for (const migration of migrations) {
      if (appliedIds.has(migration.id)) {
        console.log(`skip ${migration.id}`);
        continue;
      }

      console.log(`apply ${migration.id}`);
      await migration.up({
        sdk: {
          AlterTableDescription,
          Column,
          TableDescription,
          Types,
          TypedValues,
        },
        execute: (statement, params) => execute(driver, statement, params),
        withSession: (fn) => withSession(driver, fn),
      });
      await recordMigration(driver, migration.id);
    }

    console.log(`YDB migrations are up to date for ${database}.`);
  } finally {
    await driver.destroy();
  }
}

function createDriver() {
  return new Driver({
    endpoint,
    database,
    authService: createAuthService(),
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

function createAuthService() {
  const user = process.env.YDB_STATIC_CREDENTIALS_USER?.trim();
  if (!user) return getCredentialsFromEnv();

  const password = readPassword();
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

function readPassword() {
  const file = process.env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  if (file) return readFileSync(file, "utf8").replace(/[\r\n]+$/, "");
  const value = process.env.YDB_STATIC_CREDENTIALS_PASSWORD ?? "";
  return value.trim() || undefined;
}

async function ensureMigrationsTable(driver) {
  const exists = await tableExists(driver, MIGRATIONS_TABLE);
  if (exists) return;

  await withSession(driver, (session) =>
    session.createTable(
      MIGRATIONS_TABLE,
      new TableDescription()
        .withColumn(new Column("id", Types.UTF8))
        .withColumn(new Column("applied_at", Types.UTF8))
        .withPrimaryKey("id"),
    ),
  );
}

async function readAppliedMigrationIds(driver) {
  const result = await execute(
    driver,
    `
SELECT id
FROM ${MIGRATIONS_TABLE}
ORDER BY id
    `,
  );

  const rows = result?.resultSets?.[0]?.rows ?? [];
  return new Set(
    rows
      .map((row) => row.items?.[0]?.textValue)
      .filter((id) => typeof id === "string" && id.length > 0),
  );
}

async function readMigrations() {
  const entries = await readdir(MIGRATIONS_DIR);
  const files = entries.filter((entry) => entry.endsWith(".mjs")).sort();
  const migrations = [];

  for (const file of files) {
    const migrationModule = await import(new URL(file, MIGRATIONS_DIR).href);
    if (typeof migrationModule.up !== "function") {
      throw new Error(`Migration ${file} must export an up() function.`);
    }
    migrations.push({
      id: file.replace(/\.mjs$/, ""),
      up: migrationModule.up,
    });
  }

  return migrations;
}

async function recordMigration(driver, id) {
  await execute(
    driver,
    `
DECLARE $id AS Utf8;
DECLARE $applied_at AS Utf8;

UPSERT INTO ${MIGRATIONS_TABLE} (id, applied_at)
VALUES ($id, $applied_at)
    `,
    {
      $id: TypedValues.utf8(id),
      $applied_at: TypedValues.utf8(new Date().toISOString()),
    },
  );
}

async function execute(driver, statement, params = {}) {
  return withSession(driver, (session) => session.executeQuery(statement, params));
}

async function withSession(driver, fn) {
  return driver.tableClient.withSessionRetry(fn, 10_000, 3);
}

async function tableExists(driver, tableName) {
  try {
    await withSession(driver, (session) => session.describeTable(tableName));
    return true;
  } catch (error) {
    if (isNotFoundError(error)) return false;
    throw error;
  }
}

function isNotFoundError(error) {
  const message = String(error?.message ?? error);
  return /path not found|not found|does not exist|schemeerror|scheme error/i.test(
    message,
  );
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
