import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const IDLE_DELAY_MS = 30_000;
const ACTIVE_DELAY_MS = 1_000;

export async function runApprovalWorkerLoop({
  once,
  workerId,
  runOnce,
  sleep = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
  write = (line) => console.log(line),
  writeError = (line) => console.error(line),
}) {
  do {
    let status;
    try {
      status = await runOnce(workerId);
    } catch {
      writeError(JSON.stringify({
        operation: "approval-worker",
        status: "failed",
        failureReason: "worker_iteration_failed",
      }));
      if (once) return 1;
      await sleep(IDLE_DELAY_MS);
      continue;
    }

    write(JSON.stringify({ operation: "approval-worker", status }));
    if (once) return 0;
    await sleep(status === "idle" ? IDLE_DELAY_MS : ACTIVE_DELAY_MS);
  } while (true);
}

async function main() {
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
  return runApprovalWorkerLoop({
    once: process.argv.includes("--once"),
    workerId: process.env.HOSTNAME?.trim() || `worker-${process.pid}`,
    runOnce: runRelatedPetApprovalWorkerOnce,
  });
}

function isEntrypoint() {
  const entry = process.argv[1];
  return Boolean(entry) &&
    pathToFileURL(path.resolve(entry)).href === import.meta.url;
}

if (isEntrypoint()) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch(() => {
      console.error(JSON.stringify({
        operation: "approval-worker",
        status: "failed",
        failureReason: "worker_startup_failed",
      }));
      process.exitCode = 1;
    });
}
