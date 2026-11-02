import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {
  parentURL: import.meta.url,
  data: { sourceRootUrl: pathToFileURL(sourceRoot).href },
});
const { createSpriteGenerationWorker } = await import(pathToFileURL(path.join(sourceRoot, "lib/pets/generation/sprite-worker.ts")).href);
const { spriteRenderer } = await import(pathToFileURL(path.join(sourceRoot, "lib/pets/generation/sprite-renderer.ts")).href);
const { petGeneration } = await import(pathToFileURL(path.join(sourceRoot, "lib/pets/generation/service.ts")).href);
const { generationStore } = await import(pathToFileURL(path.join(sourceRoot, "lib/pets/generation/store.ts")).href);
const { generationCardProvider } = await import(pathToFileURL(path.join(sourceRoot, "lib/pets/generation/card-provider.ts")).href);
const {runWorkerPool} = await import(pathToFileURL(path.join(sourceRoot, "lib/pets/generation/worker-runner.ts")).href);
const controller = new AbortController();
const runPetGenerationWorkerOnce = createSpriteGenerationWorker({ service: petGeneration, store: generationStore, renderer: spriteRenderer, cardProvider: generationCardProvider, stopping: () => controller.signal.aborted });
const { destroyYdbDriver } = await import(pathToFileURL(path.join(sourceRoot, "lib/ydb/client.ts")).href);
const once = process.argv.includes("--once");
process.on("SIGTERM", () => controller.abort());
process.on("SIGINT", () => controller.abort());
try {
  const poolSize = await petGeneration.workerPoolSize();
  await runWorkerPool({runOnce: runPetGenerationWorkerOnce, maxActiveJobs: poolSize,
    signal: controller.signal, once, delay: () => petGeneration.nextWakeDelay(),
    onResult: status => {
      console.log(JSON.stringify({operation: "pet-generation-worker", status}));
      if (once && status === "iteration_failed") process.exitCode = 1;
    }});
} finally {
  await destroyYdbDriver();
}
