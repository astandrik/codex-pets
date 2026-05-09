import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import type { Session } from "ydb-sdk";

const require = createRequire(import.meta.url);
const sdk = require("ydb-sdk") as typeof import("ydb-sdk");

export const {
  Column,
  Driver,
  ExecuteQuerySettings,
  StaticCredentialsAuthService,
  TableDescription,
  Types,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = sdk;

const DRIVER_READY_TIMEOUT_MS = 15_000;
const SESSION_TIMEOUT_MS = 10_000;
const SESSION_RETRIES = 3;
const GRPC_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

let driver: InstanceType<typeof Driver> | undefined;

export function isYdbConfigured(): boolean {
  return Boolean(
    process.env.YDB_PETS_ENDPOINT?.trim() &&
      process.env.YDB_PETS_DATABASE?.trim(),
  );
}

function readPassword(): string | undefined {
  const file = process.env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  if (file) return readFileSync(file, "utf8").replace(/[\r\n]+$/, "");
  const value = process.env.YDB_STATIC_CREDENTIALS_PASSWORD ?? "";
  return value.trim() ? value : undefined;
}

function createAuthService(): unknown {
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
    process.env.YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT?.trim() ||
      process.env.YDB_PETS_ENDPOINT?.trim() ||
      "",
    getDefaultLogger(),
  );
}

function getDriver(): InstanceType<typeof Driver> {
  if (driver) return driver;
  if (!isYdbConfigured()) {
    throw new Error(
      "Missing YDB_PETS_ENDPOINT or YDB_PETS_DATABASE for Codex Pets persistence.",
    );
  }

  driver = new Driver({
    endpoint: process.env.YDB_PETS_ENDPOINT?.trim() ?? "",
    database: process.env.YDB_PETS_DATABASE?.trim() ?? "",
    authService: createAuthService(),
    clientOptions: {
      "grpc.max_receive_message_length": GRPC_MAX_MESSAGE_BYTES,
      "grpc.max_send_message_length": GRPC_MAX_MESSAGE_BYTES,
    },
    poolSettings: {
      minLimit: 1,
      maxLimit: 10,
      keepAlivePeriod: 30_000,
    },
  } as ConstructorParameters<typeof Driver>[0]);

  return driver;
}

export async function readyOrThrow(): Promise<void> {
  const ok = await getDriver().ready(DRIVER_READY_TIMEOUT_MS);
  if (!ok) {
    throw new Error("YDB driver is not ready. Check endpoint and credentials.");
  }
}

export async function withSession<T>(
  fn: (session: Session) => Promise<T>,
): Promise<T> {
  await readyOrThrow();
  return getDriver().tableClient.withSessionRetry(
    fn,
    SESSION_TIMEOUT_MS,
    SESSION_RETRIES,
  );
}

export async function destroyYdbDriver(): Promise<void> {
  if (!driver) return;
  const current = driver;
  driver = undefined;
  await current.destroy();
}
