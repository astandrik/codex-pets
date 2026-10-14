import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { register } from "node:module";
register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {
  parentURL: import.meta.url, data: { sourceRootUrl: new URL("../src/", import.meta.url).href },
});
const { collectOpenAIIndexInputs, describeOpenAIIndexInputs, applyOpenAIIndex } = await import("../src/lib/pets/openai-reindex.ts");
const { validatePrivateEmbeddingEndpoint } = await import("../src/lib/pets/openai-embedding-client.ts");
const { destroyYdbDriver, withSession } = await import("../src/lib/ydb/client.ts");
const { TABLES } = await import("../src/lib/ydb/schema.ts");
const mode = process.argv[2];
if (!["--dry-run", "--apply"].includes(mode) || process.argv.length !== 3) throw new Error("Use --dry-run or --apply");
const reportFile = process.env.PET_REINDEX_REPORT_FILE;
if (!reportFile || !process.env.YDB_PETS_ENDPOINT || !process.env.YDB_PETS_DATABASE) throw new Error("Explicit YDB target and report file required");
try {
  const schema = await withSession((session) => session.describeTable(TABLES.searchEmbeddings));
  if (JSON.stringify(schema.primaryKey) !== JSON.stringify(["model_revision", "pet_slug"]) ||
      !["dimensions", "embedding", "source_hash"].every((name) => schema.columns.some((c) => c.name === name))) {
    throw new Error("embedding_schema_mismatch");
  }
  const inputs = await collectOpenAIIndexInputs();
  const report = describeOpenAIIndexInputs(inputs);
  if (mode === "--dry-run") {
    if (existsSync(reportFile)) {
      const prior = JSON.parse(readFileSync(reportFile, "utf8"));
      if (prior.fingerprint !== report.fingerprint) throw new Error("corpus_changed_use_new_report");
    }
    writeFileSync(reportFile, JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify({ mode, ...report }));
  } else {
    const approved = JSON.parse(readFileSync(reportFile, "utf8"));
    if (approved.fingerprint !== report.fingerprint || report.conservativeUSD > 1 || report.pets < 1) throw new Error("reindex_dry_run_mismatch");
    const endpoint = validatePrivateEmbeddingEndpoint(process.env.PET_EMBEDDING_SERVICE_URL);
    const token = readFileSync(process.env.PET_EMBEDDING_SERVICE_TOKEN_FILE, "utf8").trim();
    const result = await applyOpenAIIndex(inputs, async (input) => {
      const response = await fetch(endpoint, { method: "POST", redirect: "error",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input, mode: "migration" }), signal: AbortSignal.timeout(75_000) });
      if (!response.ok) throw new Error(`embedding_service_http_${response.status}`);
      const payload = await response.json();
      return payload.data.map((row) => row.embedding);
    }, (stats) => console.log(JSON.stringify(stats)));
    const after = describeOpenAIIndexInputs(await collectOpenAIIndexInputs());
    if (report.fingerprint !== after.fingerprint) throw new Error("catalog_changed_before_acceptance");
    console.log(JSON.stringify({ mode, ...report, ...result }));
  }
} finally { await destroyYdbDriver(); }
