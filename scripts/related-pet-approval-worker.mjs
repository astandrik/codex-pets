import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
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

export function createApprovalWorkerId({ hostname, pid, randomId }) {
  const host = hostname?.trim() || "worker";
  return `${host}:${pid}:${randomId}`;
}

async function main() {
  const ledgerDirectory = process.env.PET_APPROVAL_METADATA_DIR;
  if (process.env.PET_EMBEDDING_PROFILE === "openai-large-v1") {
    if (!ledgerDirectory || !path.isAbsolute(ledgerDirectory)) throw new Error("metadata_directory_missing");
    if (process.env.PET_APPROVAL_LOCK_HELD !== "true") {
      mkdirSync(ledgerDirectory, { recursive: true, mode: 0o700 });
      return new Promise((resolve, reject) => {
        // OS lock survives process failures correctly and is shared by every container
        // mounting this ledger. A second worker must not read/modify paid receipts.
        const child = spawn("flock", ["--nonblock", "--no-fork", path.join(ledgerDirectory, "worker.lock"),
          process.execPath, ...process.argv.slice(1)], {
          stdio: "inherit", env: { ...process.env, PET_APPROVAL_LOCK_HELD: "true" },
        });
        for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => child.kill(signal));
        child.once("error", reject);
        child.once("exit", (code) => resolve(code ?? 1));
      });
    }
  }
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
  const { petModerationPaused } = await import(
    pathToFileURL(path.join(sourceRoot, "lib/pets/moderation-pause.ts")).href
  );
  return runApprovalWorkerLoop({
    once: process.argv.includes("--once"),
    workerId: createApprovalWorkerId({
      hostname: process.env.HOSTNAME,
      pid: process.pid,
      randomId: randomUUID(),
    }),
    runOnce: (workerId) => petModerationPaused() ? Promise.resolve("idle") : runRelatedPetApprovalWorkerOnce(workerId),
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
