#!/usr/bin/env node
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

import {
  claimTextHoldoutRun,
  completeTextHoldoutRun,
  readTextHoldoutEnvironment,
} from "./lib/pet-search-text-holdout.mjs";

export async function main(
  environment = process.env,
  runEvaluation = runVitest,
) {
  const { markerPath, rolloutId } = readTextHoldoutEnvironment(environment);
  await claimTextHoldoutRun(markerPath, rolloutId);
  let status = "failed";
  try {
    const exitCode = await runEvaluation(environment);
    status = exitCode === 0 ? "passed" : "failed";
    if (exitCode !== 0) {
      throw new Error(
        "Untouched text holdout failed; rollout must stop without retuning.",
      );
    }
  } finally {
    await completeTextHoldoutRun(markerPath, rolloutId, status);
  }
}

function runVitest(environment) {
  return new Promise((resolveExit, reject) => {
    const child = spawn(
      process.execPath,
      [
        "node_modules/vitest/vitest.mjs",
        "run",
        "src/lib/pets/search-live-text-eval.test.ts",
      ],
      {
        cwd: process.cwd(),
        env: {
          ...environment,
          PET_SEARCH_TEXT_LIVE_EVAL: "holdout",
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) => resolveExit(code ?? 1));
  });
}

const invokedAsScript =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((error) => {
    console.error(
      error instanceof Error ? error.message : "Text holdout execution failed.",
    );
    process.exitCode = 1;
  });
}
