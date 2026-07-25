import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  claimTextHoldoutRun,
  completeTextHoldoutRun,
  readTextHoldoutEnvironment,
} from "./lib/pet-search-text-holdout.mjs";

describe("single-use text holdout guard", () => {
  it("rejects missing and relative marker paths", () => {
    expect(() =>
      readTextHoldoutEnvironment({
        PET_SEARCH_TEXT_HOLDOUT_ROLLOUT_ID: "rollout-1",
      }),
    ).toThrow(/absolute marker path/i);
    expect(() =>
      readTextHoldoutEnvironment({
        PET_SEARCH_TEXT_HOLDOUT_MARKER_PATH: ".scratch/holdout.json",
        PET_SEARCH_TEXT_HOLDOUT_ROLLOUT_ID: "rollout-1",
      }),
    ).toThrow(/absolute marker path/i);
  });

  it("persists rollout identity and refuses a second claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pet-text-holdout-"));
    const markerPath = join(directory, "holdout.json");
    try {
      const settings = readTextHoldoutEnvironment({
        PET_SEARCH_TEXT_HOLDOUT_MARKER_PATH: markerPath,
        PET_SEARCH_TEXT_HOLDOUT_ROLLOUT_ID: "text-v2-2026-07-25",
      });
      await claimTextHoldoutRun(
        settings.markerPath,
        settings.rolloutId,
        () => new Date("2026-07-25T00:00:00.000Z"),
      );
      expect(JSON.parse(await readFile(markerPath, "utf8"))).toMatchObject({
        rolloutId: "text-v2-2026-07-25",
        status: "started",
      });
      await completeTextHoldoutRun(
        settings.markerPath,
        settings.rolloutId,
        "failed",
      );
      expect(JSON.parse(await readFile(markerPath, "utf8"))).toMatchObject({
        rolloutId: "text-v2-2026-07-25",
        status: "failed",
      });
      await expect(
        claimTextHoldoutRun(settings.markerPath, settings.rolloutId),
      ).rejects.toThrow(/already run/i);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
