import { describe, expect, it, vi } from "vitest";

import { pollApprovalPreparation } from "./approval-preparation-client";

describe("approval preparation polling", () => {
  it("requests the current status before the first delay", async () => {
    const events: string[] = [];

    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn(async () => {
        events.push("fetch");
        return Response.json({ status: "succeeded" });
      }),
      sleep: vi.fn(async () => {
        events.push("sleep");
      }),
      maxAttempts: 1,
    })).resolves.toBe("succeeded");

    expect(events).toEqual(["fetch"]);
  });

  it("continues through queued states and transient responses", async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "queued" }))
      .mockResolvedValueOnce(Response.json({ status: "succeeded" }));

    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl,
      sleep: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 4,
    })).resolves.toBe("succeeded");
  });

  it("distinguishes terminal API failures from timeouts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
      sleep,
      maxAttempts: 1,
    })).resolves.toBe("failed");
    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ status: "retry" })),
      sleep,
      maxAttempts: 1,
    })).resolves.toBe("timeout");
  });

  it("aborts a hung status request and exhausts the bounded attempts", async () => {
    const polling = pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn((_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
      ),
      sleep: vi.fn().mockResolvedValue(undefined),
      maxAttempts: 1,
      requestTimeoutMs: 5,
    });

    await expect(Promise.race([
      polling,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("status fetch remained pending")), 50)
      ),
    ])).resolves.toBe("timeout");
  });

  it("fails malformed or unknown successful responses", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(new Response("not-json")),
      sleep,
      maxAttempts: 1,
    })).resolves.toBe("failed");
    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ status: "mystery" })),
      sleep,
      maxAttempts: 1,
    })).resolves.toBe("failed");
  });
});
