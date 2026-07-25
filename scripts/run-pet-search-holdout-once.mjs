#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  claimHoldoutRun,
  completeHoldoutRun,
} from "./lib/pet-search-holdout.mjs";

const MARKER = resolve(
  process.cwd(),
  ".scratch/pet-caption-bakeoff/holdout-run.json",
);

export async function main() {
  await claimHoldoutRun(MARKER);
  let status = "failed";
  try {
    const exitCode = await runVitest();
    status = exitCode === 0 ? "passed" : "failed";
    if (exitCode !== 0) {
      throw new Error(
        "Untouched holdout failed; rollout must stop without candidate retuning.",
      );
    }
  } finally {
    await completeHoldoutRun(MARKER, status);
  }
}

function runVitest() {
  return new Promise((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "src/lib/pets/search-live-eval.test.ts",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PET_SEARCH_LIVE_EVAL: "holdout",
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

const invokedAsScript =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Holdout execution failed.",
    );
    process.exitCode = 1;
  });
}
