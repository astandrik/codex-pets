import { describe, expect, it, vi } from "vitest";

import { pollApprovalPreparation, parseApprovalSnapshot } from "./approval-preparation-client";

describe("approval preparation polling", () => {
  it("emits network loss, recovered status and retry timing without POST", async () => {
    const updates = vi.fn();
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(Response.json({ status: "queued", preparationId: "approval-1", attempts: 0 }))
      .mockResolvedValueOnce(Response.json({ status: "retry", nextAttemptAt: "2026-10-11T20:00:00Z" }))
      .mockResolvedValueOnce(Response.json({ status: "succeeded" }));
    expect(await pollApprovalPreparation("https://pets.test/status", { fetchImpl, sleep: async () => undefined, onUpdate: updates })).toEqual({ status: "succeeded" });
    expect(updates.mock.calls.map(([u]) => u.connection)).toEqual(["lost", "connected", "connected", "connected"]);
    expect(updates.mock.calls[2][0].snapshot.nextAttemptAt).toBe("2026-10-11T20:00:00Z");
    expect(fetchImpl.mock.calls.every(([, options]) => !options.method && options.cache === "no-store")).toBe(true);
  });
  it("cancels in-flight reads without reporting a failure or starting another read", async () => {
    const parent = new AbortController(); const update = vi.fn();
    const fetchImpl = vi.fn((_url, options) => new Promise<Response>((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")))));
    const result = pollApprovalPreparation("https://pets.test/status", { fetchImpl, signal: parent.signal, onUpdate: update });
    parent.abort(); expect(await result).toEqual({ status: "cancelled" });
    expect(fetchImpl).toHaveBeenCalledOnce(); expect(update).not.toHaveBeenCalled();
  });
  it("respects a wall-clock deadline and strips unsafe or invalid snapshot fields", async () => {
    const fetchImpl = vi.fn();
    expect(await pollApprovalPreparation("https://pets.test/status", { fetchImpl, maxDurationMs: 0 })).toEqual({ status: "timeout" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(parseApprovalSnapshot({ status: "preparing", preparationId: "../private", attempts: -1, updatedAt: "nonsense", failureCode: "private provider text", leaseOwner: "private" }))
      .toEqual({ status: "preparing", preparationId: null, attempts: null, updatedAt: null, createdAt: null, failureCode: null, leaseUntil: null, nextAttemptAt: null });
  });

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
    })).resolves.toEqual({ status: "succeeded" });

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
    })).resolves.toEqual({ status: "succeeded" });
  });

  it("distinguishes terminal API failures from timeouts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(new Response(null, { status: 403 })),
      sleep,
      maxAttempts: 1,
    })).resolves.toEqual({ status: "failed" });
    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ status: "retry" })),
      sleep,
      maxAttempts: 1,
    })).resolves.toEqual({ status: "timeout" });
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
    ])).resolves.toEqual({ status: "timeout" });
  });

  it("keeps the deadline active while reading a stalled response body", async () => {
    const updates = vi.fn();
    const fetchImpl = vi.fn(async (_url, options) => new Response(new ReadableStream({
      start(stream) { options.signal.addEventListener("abort", () => stream.error(new DOMException("aborted", "AbortError"))); },
    })));
    expect(await pollApprovalPreparation("https://pets.test/status", { fetchImpl, requestTimeoutMs: 5, maxAttempts: 1, onUpdate: updates })).toEqual({ status: "timeout" });
    expect(updates).toHaveBeenCalledWith({ connection: "lost" });
  });
  it("fails malformed or unknown successful responses", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(new Response("not-json")),
      sleep,
      maxAttempts: 1,
    })).resolves.toEqual({ status: "failed" });
    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(Response.json({ status: "mystery" })),
      sleep,
      maxAttempts: 1,
    })).resolves.toEqual({ status: "failed" });
  });
  it.each([
    ["schema_invalid", "schema_invalid"],
    ["invalid error detail", null],
    ["x".repeat(65), null],
    [123, null],
  ])("only returns a bounded failure code for manual review", async (input, expected) => {
    await expect(pollApprovalPreparation("https://pets.test/status", {
      fetchImpl: vi.fn().mockResolvedValue(Response.json({
        status: "manual_review",
        failureCode: input,
      })),
      maxAttempts: 1,
    })).resolves.toEqual({ status: "manual_review", failureCode: expected });
  });

});
