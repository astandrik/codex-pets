import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptsRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(scriptsRoot, "../src");
register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {
  parentURL: import.meta.url,
  data: { sourceRootUrl: pathToFileURL(sourceRoot).href },
});

const { runRelatedPetApprovalWorkerOnce } = await import(
  pathToFileURL(
    path.join(sourceRoot, "lib/pets/related-pets-approval-worker.ts"),
  ).href
);

const once = process.argv.includes("--once");
const workerId = process.env.HOSTNAME?.trim() || `worker-${process.pid}`;

do {
  const status = await runRelatedPetApprovalWorkerOnce(workerId);
  console.log(JSON.stringify({ operation: "approval-worker", status }));
  if (once) break;
  await new Promise((resolve) =>
    setTimeout(resolve, status === "idle" ? 30_000 : 1_000),
  );
} while (true);
