import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  claimHoldoutRun,
  completeHoldoutRun,
} from "./lib/pet-search-holdout.mjs";

describe("single-use holdout guard", () => {
  it("claims before execution and permanently rejects a second run", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pet-holdout-"));
    const marker = join(directory, "holdout-run.json");
    try {
      await claimHoldoutRun(marker, () =>
        new Date("2026-07-25T00:00:00.000Z")
      );
      await expect(claimHoldoutRun(marker)).rejects.toThrow(/already run/i);
      await completeHoldoutRun(marker, "failed");
      expect(JSON.parse(await readFile(marker, "utf8"))).toMatchObject({
        startedAt: "2026-07-25T00:00:00.000Z",
        status: "failed",
      });
      await expect(claimHoldoutRun(marker)).rejects.toThrow(/already run/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
