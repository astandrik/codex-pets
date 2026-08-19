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
    expect(() => parseResumableBackfillArgs(["--apply", "--slug="]))
      .toThrow(/valid public pet slug/i);
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

  it("drains started workers before rethrowing a terminal failure", async () => {
    const terminalError = new Error("terminal_failure");
    const started: string[] = [];
    let releasePeer!: () => void;
    const peerRelease = new Promise<void>((resolve) => {
      releasePeer = resolve;
    });
    let markPeerStarted!: () => void;
    const peerStarted = new Promise<void>((resolve) => {
      markPeerStarted = resolve;
    });
    let markFailureIssued!: () => void;
    const failureIssued = new Promise<void>((resolve) => {
      markFailureIssued = resolve;
    });
    let peerFinished = false;
    let settled = false;

    const result = runResumableBackfill({
      items: [{ slug: "a" }, { slug: "b" }, { slug: "c" }],
      options: {
        mode: "dry-run",
        slug: null,
        force: false,
        continueOnError: false,
        concurrency: 2,
      },
      processItem: async ({ slug }) => {
        started.push(slug);
        if (slug === "a") {
          await peerStarted;
          markFailureIssued();
          throw terminalError;
        }
        if (slug === "b") {
          markPeerStarted();
          await peerRelease;
          peerFinished = true;
        }
        return "updated";
      },
      log: vi.fn(),
    }).then(
      () => ({ status: "resolved" as const }),
      (error) => ({ status: "rejected" as const, error }),
    ).finally(() => {
      settled = true;
    });

    await failureIssued;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);
    expect(peerFinished).toBe(false);
    expect(started).toEqual(["a", "b"]);

    releasePeer();
    await expect(result).resolves.toEqual({
      status: "rejected",
      error: terminalError,
    });
    expect(peerFinished).toBe(true);
    expect(started).toEqual(["a", "b"]);
  });
});
