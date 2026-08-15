import { describe, expect, it, vi } from "vitest";

const {
  parseResumableBackfillArgs,
  runResumableBackfill,
} = await import("./resumable-backfill.mjs");

describe("resumable backfill helper", () => {
  it("uses node parseArgs and validates safe combinations", () => {
    expect(parseResumableBackfillArgs(["--dry-run"])).toEqual({
      mode: "dry-run",
      slug: null,
      force: false,
      continueOnError: false,
      concurrency: 1,
    });
    expect(parseResumableBackfillArgs([
      "--apply",
      "--continue-on-error",
      "--concurrency=5",
    ])).toMatchObject({
      mode: "apply",
      continueOnError: true,
      concurrency: 5,
    });
    expect(() => parseResumableBackfillArgs(["--apply", "--unknown"]))
      .toThrow(/unknown argument/i);
    expect(() => parseResumableBackfillArgs([
      "--apply",
      "--concurrency=2",
    ])).toThrow(/continue-on-error/i);
  });

  it("keeps successful results when another item fails", async () => {
    const log = vi.fn();
    const summary = await runResumableBackfill({
      items: [{ slug: "a" }, { slug: "b" }, { slug: "c" }],
      options: {
        mode: "apply",
        slug: null,
        force: false,
        continueOnError: true,
        concurrency: 2,
      },
      processItem: async ({ slug }) => {
        if (slug === "b") throw Object.assign(new Error("provider_failed"), {
          reason: "provider_failed",
        });
        return slug === "a" ? "updated" : "unchanged";
      },
      log,
    });

    expect(summary).toEqual({
      scanned: 3,
      unchanged: 1,
      planned: 0,
      updated: 1,
      failed: 1,
      failedSlugs: ["b"],
    });
    expect(log).toHaveBeenCalledWith(expect.objectContaining({
      action: "failed",
      reason: "provider_failed",
    }));
  });
});
