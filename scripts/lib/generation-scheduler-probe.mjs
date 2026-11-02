// Test-only process: refuses non-local or non-disposable databases before imports.
import {register} from "node:module";
import {pathToFileURL} from "node:url";
import path from "node:path";
const endpoint = new URL(process.env.YDB_PETS_ENDPOINT ?? "invalid:");
if (!['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname) ||
    !/^\/local\/codex_parallelism_test_[a-z0-9]+$/.test(process.env.YDB_PETS_DATABASE ?? "")) throw Error("Disposable local database required");
const root = path.resolve("src");
register(new URL("./related-pets-typescript-loader.mjs", import.meta.url), {parentURL: import.meta.url, data: {sourceRootUrl: pathToFileURL(root).href}});
const load = name => import(pathToFileURL(path.join(root, `lib/pets/generation/${name}.ts`)).href);
const {generationStore} = await load("store");
const {createGenerationService} = await load("service");
const {WorkerYield} = await load("scheduler");
const {STAGE_NAMES} = await load("model");
const {destroyYdbDriver} = await import(pathToFileURL(path.join(root, "lib/ydb/client.ts")).href);
const service = createGenerationService(generationStore, {enabled: () => true, secret: () => "isolated-local-scheduler-test-secret", automaticAnimationRepair: () => true});
try {
  let job = await service.claim(process.argv[2]);
  let starts = 0;
  if (job) {
    job = await service.beginStage(job, "base");
    try {
      await service.authorizeStage(job, "base");
      await service.saveStage(job, "base", Buffer.from("synthetic base"), {generationMs: 0,
        usage: {textInputTokens: 0, imageInputTokens: 0, outputTokens: 0, costUsd: 0}});
      job = await service.beginStages(job, STAGE_NAMES.slice(1));
      for (const attempt of job.animationRepair.attempts) {
        await service.startAnimationAttempt(job, attempt.state, attempt.token);
        starts++;
      }
    } catch (error) { if (!(error instanceof WorkerYield)) throw error; }
  }
  console.log("PROBE:" + JSON.stringify({claimed: Boolean(job), starts}));
} finally { await destroyYdbDriver(); }
