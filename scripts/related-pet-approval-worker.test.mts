import { spawnSync } from "node:child_process";

import { describe, expect, it, vi } from "vitest";

import {
  createApprovalWorkerId,
  runApprovalWorkerLoop,
} from "./related-pet-approval-worker.mjs";

describe("approval worker loop", () => {
  it("loads the production worker entrypoint in standalone Node", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/related-pet-approval-worker.mjs", "--once"],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          YDB_PETS_ENDPOINT: "",
          YDB_PETS_DATABASE: "",
          YANDEX_AI_STUDIO_FOLDER_ID: "",
          YANDEX_AI_STUDIO_API_KEY_FILE: "",
          PET_SEARCH_MODEL_REVISION: "",
          PET_SEARCH_VISION_CAPTION_REVISION: "",
          PET_SEARCH_VISUAL_MODEL_REVISION: "",
        },
      },
    );

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      operation: "approval-worker",
      status: "idle",
    });
  });

  it("creates a unique stable owner for each process", () => {
    expect(createApprovalWorkerId({
      hostname: "worker-host",
      pid: 42,
      randomId: "first",
    })).toBe("worker-host:42:first");
    expect(createApprovalWorkerId({
      hostname: "worker-host",
      pid: 42,
      randomId: "second",
    })).not.toBe("worker-host:42:first");
  });

  it("treats reclaimed work as an active iteration", async () => {
    const write = vi.fn();
    await expect(runApprovalWorkerLoop({
      once: true,
      workerId: "worker-1",
      runOnce: vi.fn().mockResolvedValue("in_progress"),
      write,
    })).resolves.toBe(0);
    expect(write).toHaveBeenCalledWith(JSON.stringify({
      operation: "approval-worker",
      status: "in_progress",
    }));
  });
  it("fails one-shot runs without exposing the error", async () => {
    const errors: string[] = [];

    await expect(runApprovalWorkerLoop({
      once: true,
      workerId: "worker-1",
      runOnce: vi.fn().mockRejectedValue(new Error("private provider detail")),
      writeError: (line) => errors.push(line),
    })).resolves.toBe(1);

    expect(errors).toEqual([JSON.stringify({
      operation: "approval-worker",
      status: "failed",
      failureReason: "worker_iteration_failed",
    })]);
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
