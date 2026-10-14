import { randomUUID } from "node:crypto";
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
const runPetGenerationWorkerOnce = createSpriteGenerationWorker({ service: petGeneration, store: generationStore, renderer: spriteRenderer, cardProvider: generationCardProvider });
const { destroyYdbDriver } = await import(pathToFileURL(path.join(sourceRoot, "lib/ydb/client.ts")).href);
const once = process.argv.includes("--once");
const owner = randomUUID();
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
try {
  do {
    try {
      const status = await runPetGenerationWorkerOnce(owner);
      console.log(JSON.stringify({ operation: "pet-generation-worker", status }));
    } catch {
      console.error(JSON.stringify({ operation: "pet-generation-worker", status: "iteration_failed" }));
      if (once) process.exitCode = 1;
    }
    if (!once && !stopping) await new Promise((resolve) => setTimeout(resolve, 5000));
  } while (!once && !stopping);
} finally {
  await destroyYdbDriver();
}
