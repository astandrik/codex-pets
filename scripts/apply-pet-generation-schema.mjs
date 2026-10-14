import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { up } from "../ydb/migrations/20261009_001_add_pet_generation.mjs";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {
  parentURL: import.meta.url,
  data: { sourceRootUrl: pathToFileURL(sourceRoot).href },
});
const sdk = await import(pathToFileURL(path.join(sourceRoot, "lib/ydb/client.ts")).href);
try {
  await up({ sdk, withSession: sdk.withSession });
  await sdk.withSession((session) => session.executeQuery(
    "DECLARE $id AS Utf8; DECLARE $at AS Utf8; UPSERT INTO codex_schema_migrations (id, applied_at) VALUES ($id, $at);",
    { $id: sdk.TypedValues.utf8("20261009_001_add_pet_generation"), $at: sdk.TypedValues.utf8(new Date().toISOString()) },
  ));
  console.log(JSON.stringify({ migration: "20261009_001_add_pet_generation", status: "applied" }));
} finally {
  await sdk.destroyYdbDriver();
}
