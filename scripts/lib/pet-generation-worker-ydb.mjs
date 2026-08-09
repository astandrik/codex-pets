import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  Driver,
  StaticCredentialsAuthService,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = require("ydb-sdk");

export async function createGenerationWorkerYdb(env = process.env) {
  const endpoint = env.YDB_PETS_ENDPOINT?.trim();
  const database = env.YDB_PETS_DATABASE?.trim();
  if (!endpoint || !database) throw new Error("Generation worker requires YDB_PETS_ENDPOINT and YDB_PETS_DATABASE.");
  if (isLocalEndpoint(endpoint)) {
    process.env.YDB_ANONYMOUS_CREDENTIALS ??= "1";
    process.env.YDB_ENDPOINT ??= endpoint;
  }
  const driver = new Driver({
    endpoint,
    database,
    authService: authService(env, endpoint),
    clientOptions: {
      "grpc.max_receive_message_length": 16 * 1024 * 1024,
      "grpc.max_send_message_length": 16 * 1024 * 1024,
    },
    poolSettings: { minLimit: 1, maxLimit: 2, keepAlivePeriod: 30_000 },
  });
  if (!await driver.ready(15_000)) {
    await driver.destroy();
    throw new Error("Generation worker YDB driver is not ready.");
  }
  return {
    TypedValues,
    withSession: (operation) => driver.tableClient.withSessionRetry(operation, 10_000, 3),
    destroy: () => driver.destroy(),
  };
}

function authService(env, endpoint) {
  const user = env.YDB_STATIC_CREDENTIALS_USER?.trim();
  if (!user) return getCredentialsFromEnv();
  const file = env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  const password = file
    ? readFileSync(file, "utf8").replace(/[\r\n]+$/, "")
    : env.YDB_STATIC_CREDENTIALS_PASSWORD?.trim();
  if (!password) throw new Error("Generation worker YDB static credentials are incomplete.");
  return new StaticCredentialsAuthService(
    user,
    password,
    env.YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT?.trim() || endpoint,
    getDefaultLogger(),
  );
}

function isLocalEndpoint(value) {
  try { return ["localhost", "127.0.0.1", "::1", "ydb-local"].includes(new URL(value).hostname); }
  catch { return false; }
}
