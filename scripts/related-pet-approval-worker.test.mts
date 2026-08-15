import { describe, expect, it, vi } from "vitest";

import { runApprovalWorkerLoop } from "./related-pet-approval-worker.mjs";

describe("approval worker loop", () => {
  it("fails one-shot runs when an iteration throws", async () => {
    const errors: string[] = [];

    await expect(runApprovalWorkerLoop({
      once: true,
      workerId: "worker-1",
      runOnce: vi.fn().mockRejectedValue(new Error("private provider detail")),
      writeError: (line) => errors.push(line),
    })).resolves.toBe(1);

    expect(errors).toEqual([
      JSON.stringify({
        operation: "approval-worker",
        status: "failed",
        failureReason: "worker_iteration_failed",
      }),
    ]);
    expect(errors.join("\n")).not.toContain("private provider detail");
  });

  it("backs off and continues after a daemon iteration failure", async () => {
    const sleep = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new StopLoop());
    const write = vi.fn();
    const writeError = vi.fn();
    const runOnce = vi.fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce("succeeded");

    await expect(runApprovalWorkerLoop({
      once: false,
      workerId: "worker-1",
      runOnce,
      sleep,
      write,
      writeError,
    })).rejects.toBeInstanceOf(StopLoop);

    expect(sleep).toHaveBeenNthCalledWith(1, 30_000);
    expect(sleep).toHaveBeenNthCalledWith(2, 1_000);
    expect(write).toHaveBeenCalledWith(JSON.stringify({
      operation: "approval-worker",
      status: "succeeded",
    }));
    expect(writeError).toHaveBeenCalledTimes(1);
  });
});

class StopLoop extends Error {}
