#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function parseMetadataRepairArgs(argv) {
  if (argv.length !== 3 || !["--dry-run", "--generate-only", "--apply-records"].includes(argv[0]) ||
      argv[1] !== "--pet-id" || argv[2] !== "pet_c403f5c2bb2447ecacd554") {
    throw new Error("metadata_usage_requires_mode_and_exact_lumi_id");
  }
  return { mode: argv[0].slice(2), petId: argv[2] };
}

async function main() {
  const options = parseMetadataRepairArgs(process.argv.slice(2));
  const directory = process.env.PET_METADATA_LEDGER_DIR;
  if (!directory || !path.isAbsolute(directory)) throw new Error("metadata_ledger_directory_required");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.env.PET_METADATA_FLOCK_HELD !== "1") {
    const result = spawnSync("flock", ["-n", "-E", "73", path.join(directory, "worker.lock"), process.execPath,
      fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
      env: { ...process.env, PET_METADATA_FLOCK_HELD: "1" }, stdio: "inherit",
    });
    if (result.error) throw new Error("metadata_singleton_lock_unavailable");
    if (result.status === 73) console.error(JSON.stringify({ status: "blocked", reason: "metadata_worker_busy" }));
    process.exitCode = result.status ?? 1;
    return;
  }
  register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), { parentURL: import.meta.url,
    data: { sourceRootUrl: new URL("../src/", import.meta.url).href } });
  const { destroyYdbDriver } = await import("../src/lib/ydb/client.ts");
  try {
    const { runLumiMetadataRepair } = await import("../src/lib/pets/metadata-worker/lumi-repair.ts");
    console.log(JSON.stringify(await runLumiMetadataRepair(options.mode, options.petId, directory)));
  } finally { await destroyYdbDriver(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const reason = error instanceof Error && /^metadata_[a-z0-9_]+$/.test(error.message)
      ? error.message : "metadata_operation_failed";
    console.error(JSON.stringify({ status: "blocked", reason })); process.exitCode = 1;
  });
}
