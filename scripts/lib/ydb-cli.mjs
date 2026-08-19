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

export { TypedValues };

export function readYdbCliConfig(
  env = process.env,
  { requireExplicitTarget = false } = {},
) {
  const explicitEndpoint = env.YDB_PETS_ENDPOINT?.trim();
  const explicitDatabase = env.YDB_PETS_DATABASE?.trim();
  if (requireExplicitTarget && (!explicitEndpoint || !explicitDatabase)) {
    const missing = [
      !explicitEndpoint && "YDB_PETS_ENDPOINT",
      !explicitDatabase && "YDB_PETS_DATABASE",
    ].filter(Boolean);
    throw new Error(`--apply requires explicit ${missing.join(" and ")}.`);
  }
  return {
    endpoint: explicitEndpoint || "grpc://127.0.0.1:2136",
    database: explicitDatabase || "/local",
  };
}

export function createYdbCliDriver({
  env = process.env,
  requireExplicitTarget = false,
} = {}) {
  const { endpoint, database } = readYdbCliConfig(env, {
    requireExplicitTarget,
  });
  if (isLocalYdbEndpoint(endpoint)) {
    env.YDB_ANONYMOUS_CREDENTIALS ??= "1";
    env.YDB_ENDPOINT ??= endpoint;
  }
  const user = env.YDB_STATIC_CREDENTIALS_USER?.trim();
  const authService = user
    ? new StaticCredentialsAuthService(
        user,
        readStaticPassword(env),
        env.YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT?.trim() || endpoint,
        getDefaultLogger(),
      )
    : getCredentialsFromEnv();
  return {
    endpoint,
    database,
    driver: new Driver({
      endpoint,
      database,
      authService,
      clientOptions: {
        "grpc.max_receive_message_length": 16 * 1024 * 1024,
        "grpc.max_send_message_length": 16 * 1024 * 1024,
      },
      poolSettings: {
        minLimit: 1,
        maxLimit: 4,
        keepAlivePeriod: 30_000,
      },
    }),
  };
}

export async function withYdbCliDriver(callback, options = {}) {
  const connection = createYdbCliDriver(options);
  try {
    if (!(await connection.driver.ready(options.readyTimeoutMs ?? 15_000))) {
      throw new Error(
        `YDB driver is not ready for ${connection.endpoint} ${connection.database}.`,
      );
    }
    return await callback(connection.driver);
  } finally {
    await connection.driver.destroy();
  }
}

export function executeYdbQuery(driver, statement, params = {}) {
  return driver.tableClient.withSessionRetry(
    (session) => session.executeQuery(statement, params),
    10_000,
    3,
  );
}

export function rowsFromResult(result) {
  return result?.resultSets?.[0]?.rows ?? [];
}

export function textAt(row, index) {
  return row.items?.[index]?.textValue ?? "";
}

export function uint32At(row, index) {
  return Number(row.items?.[index]?.uint32Value ?? 0);
}

export function parseStringArray(value) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item) => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function isLocalYdbEndpoint(value) {
  try {
    return ["localhost", "127.0.0.1", "::1", "[::1]", "ydb-local"].includes(
      new URL(value).hostname,
    );
  } catch {
    return false;
  }
}

function readStaticPassword(env) {
  const file = env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  const password = file
    ? readFileSync(file, "utf8").replace(/[\r\n]+$/, "")
    : env.YDB_STATIC_CREDENTIALS_PASSWORD?.trim();
  if (!password) {
    throw new Error("YDB static credentials password is missing.");
  }
  return password;
}
