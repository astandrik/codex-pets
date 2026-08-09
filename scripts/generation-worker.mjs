#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { hostname } from "node:os";

import { getPetGenerationConfig } from "../src/lib/pets/generation/config-runtime.mjs";
import { createOpenAIPetGenerationProvider } from "./lib/pet-generation-provider.mjs";
import { createGenerationWorkerRepository } from "./lib/pet-generation-worker-repository.mjs";
import { createGenerationWorkerRuntime } from "./lib/pet-generation-worker-runtime.mjs";
import { createGenerationWorkerYdb } from "./lib/pet-generation-worker-ydb.mjs";

const config = getPetGenerationConfig();
if (!config.enabled) {
  console.log(JSON.stringify({ event: "generation_worker_disabled" }));
  process.exit(0);
}

const workerId = `${hostname()}:${process.pid}`.slice(0, 120);
const ydb = await createGenerationWorkerYdb();
const repository = createGenerationWorkerRepository({
  withSession: ydb.withSession,
  TypedValues: ydb.TypedValues,
  leaseSeconds: config.leaseSeconds,
  maxImageCalls: config.maxImageCalls,
});
const provider = createOpenAIPetGenerationProvider({
  apiKey: readApiKey(),
  baseUrl: process.env.OPENAI_BASE_URL?.trim(),
  imageModel: config.model,
  reviewModel: config.reviewModel,
});
const runtime = createGenerationWorkerRuntime({ repository, provider, config, workerId });
const pollMs = bounded(process.env.PET_GENERATION_POLL_MS, 2_000, 250, 30_000);
const once = process.env.PET_GENERATION_WORKER_ONCE?.trim().toLowerCase() === "true";
let stopping = false;
let lastCleanup = 0;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; });

try {
  console.log(JSON.stringify({ event: "generation_worker_started", workerId, concurrency: 1 }));
  do {
    if (Date.now() - lastCleanup > 3_600_000) {
      const deleted = await repository.cleanupExpired();
      if (deleted) console.log(JSON.stringify({ event: "artifact_cleanup", deleted }));
      lastCleanup = Date.now();
    }
    const processed = await runtime.processNextRun();
    if (!processed && !once && !stopping) await sleep(pollMs);
  } while (!once && !stopping);
} finally {
  await ydb.destroy();
  console.log(JSON.stringify({ event: "generation_worker_stopped", workerId }));
}

function readApiKey() {
  const file = process.env.OPENAI_API_KEY_FILE?.trim();
  const value = file ? readFileSync(file, "utf8").replace(/[\r\n]+$/, "") : process.env.OPENAI_API_KEY?.trim();
  if (!value) throw new Error("Generation worker requires OPENAI_API_KEY_FILE or OPENAI_API_KEY.");
  return value;
}
function bounded(value, fallback, min, max) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
