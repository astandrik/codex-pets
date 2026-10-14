import { readFileSync } from "node:fs";
import { register } from "node:module";
register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {
  parentURL: import.meta.url, data: { sourceRootUrl: new URL("../src/", import.meta.url).href },
});
const { createAMSOpenAITransport } = await import("../src/lib/pets/embedding-worker/transport.ts");
const { EmbeddingLedger } = await import("../src/lib/pets/embedding-worker/ledger.ts");
const { createEmbeddingServer } = await import("../src/lib/pets/embedding-worker/server.ts");
const key = readFileSync(process.env.OPENAI_API_KEY_FILE, "utf8").trim();
const token = readFileSync(process.env.PET_EMBEDDING_SERVICE_TOKEN_FILE, "utf8").trim();
const request = createAMSOpenAITransport(key, process.env.HTTPS_PROXY);
const ledger = new EmbeddingLedger(process.env.PET_EMBEDDING_LEDGER_DIR,
  Number(process.env.PET_EMBEDDING_MIGRATION_BUDGET_USD ?? "1"), request);
const server = createEmbeddingServer({ token, ledger, request,
  allowOnline: process.env.PET_EMBEDDING_ONLINE_ENABLED === "true" });
server.requestTimeout = 75_000;
server.headersTimeout = 10_000;
server.listen(8090, "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => server.close());
