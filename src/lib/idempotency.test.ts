import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimIdempotencyKey,
  hashIdempotencyPayload,
  releaseIdempotencyClaim,
  storeIdempotencyResult,
} from "@/lib/idempotency";

describe("idempotency helpers", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reserves a fresh key before a result is stored", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const route = `POST /test/${crypto.randomUUID()}`;
    const key = "claim-before-side-effect";
    const requestHash = hashIdempotencyPayload({ prompt: "same" });

    const first = await claimIdempotencyKey({ route, key, requestHash });
    const overlap = await claimIdempotencyKey({ route, key, requestHash });

    expect(first.kind).toBe("fresh");
    expect(overlap.kind).toBe("in_progress");
    if (overlap.kind !== "in_progress") return;
    expect(overlap.response.status).toBe(409);
    await expect(overlap.response.json()).resolves.toMatchObject({
      error: "idempotency_key_in_progress",
      code: "idempotency_key_in_progress",
    });

    await storeIdempotencyResult({
      route,
      key,
      requestHash,
      statusCode: 201,
      responseBody: { ok: true },
    });
    const replay = await claimIdempotencyKey({ route, key, requestHash });
    expect(replay.kind).toBe("replay");
  });

  it("allows a stale in-progress claim to be retried", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const route = `POST /test/${crypto.randomUUID()}`;
    const key = "stale-in-progress";
    const requestHash = hashIdempotencyPayload({ prompt: "same" });

    const first = await claimIdempotencyKey({ route, key, requestHash });
    vi.setSystemTime(new Date("2026-05-29T10:10:01.000Z"));
    const retry = await claimIdempotencyKey({ route, key, requestHash });

    expect(first.kind).toBe("fresh");
    expect(retry.kind).toBe("fresh");
  });

  it("releases an in-progress claim after a failed mutation", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const route = `POST /test/${crypto.randomUUID()}`;
    const key = "release-failed-mutation";
    const requestHash = hashIdempotencyPayload({ prompt: "same" });

    const first = await claimIdempotencyKey({ route, key, requestHash });
    await releaseIdempotencyClaim({ route, key, requestHash });
    const retry = await claimIdempotencyKey({ route, key, requestHash });

    expect(first.kind).toBe("fresh");
    expect(retry.kind).toBe("fresh");
  });

  it("hashes undefined values deterministically", () => {
    expect(() => hashIdempotencyPayload({ optional: undefined })).not.toThrow();
    expect(hashIdempotencyPayload({ optional: undefined })).toBe(
      hashIdempotencyPayload({ optional: undefined }),
    );
  });
});
