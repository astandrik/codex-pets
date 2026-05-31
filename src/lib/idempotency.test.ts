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

    if (first.kind !== "fresh") return;
    await storeIdempotencyResult({
      route,
      key,
      requestHash,
      claim: first.claim,
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
    if (first.kind !== "fresh") return;
    await releaseIdempotencyClaim({ route, key, requestHash, claim: first.claim });
    const retry = await claimIdempotencyKey({ route, key, requestHash });

    expect(first.kind).toBe("fresh");
    expect(retry.kind).toBe("fresh");
  });

  it("does not release a newer in-progress claim with a stale claim token", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const route = `POST /test/${crypto.randomUUID()}`;
    const key = "release-stale-token";
    const requestHash = hashIdempotencyPayload({ prompt: "same" });

    const stale = await claimIdempotencyKey({ route, key, requestHash });
    vi.setSystemTime(new Date("2026-05-29T10:10:01.000Z"));
    const current = await claimIdempotencyKey({ route, key, requestHash });
    if (stale.kind !== "fresh" || current.kind !== "fresh") return;
    await releaseIdempotencyClaim({
      route,
      key,
      requestHash,
      claim: stale.claim,
    });
    const overlap = await claimIdempotencyKey({ route, key, requestHash });

    expect(overlap.kind).toBe("in_progress");
  });

  it("does not let a stale claim overwrite a newer completed response", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const route = `POST /test/${crypto.randomUUID()}`;
    const key = "store-stale-token";
    const requestHash = hashIdempotencyPayload({ prompt: "same" });

    const stale = await claimIdempotencyKey({ route, key, requestHash });
    vi.setSystemTime(new Date("2026-05-29T10:10:01.000Z"));
    const current = await claimIdempotencyKey({ route, key, requestHash });
    if (stale.kind !== "fresh" || current.kind !== "fresh") return;
    const staleStored = await storeIdempotencyResult({
      route,
      key,
      requestHash,
      claim: stale.claim,
      statusCode: 201,
      responseBody: { ok: true, request: { id: "stale" } },
    });
    const currentStored = await storeIdempotencyResult({
      route,
      key,
      requestHash,
      claim: current.claim,
      statusCode: 201,
      responseBody: { ok: true, request: { id: "current" } },
    });
    const replay = await claimIdempotencyKey({ route, key, requestHash });

    expect(staleStored).toBe(false);
    expect(currentStored).toBe(true);
    expect(replay.kind).toBe("replay");
    if (replay.kind !== "replay") return;
    await expect(replay.response.json()).resolves.toMatchObject({
      request: { id: "current" },
    });
  });

  it("allows a completed key to be reused after the retention window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const route = `POST /test/${crypto.randomUUID()}`;
    const key = "retained-for-one-day";
    const requestHash = hashIdempotencyPayload({ prompt: "same" });

    const first = await claimIdempotencyKey({ route, key, requestHash });
    if (first.kind !== "fresh") return;
    await storeIdempotencyResult({
      route,
      key,
      requestHash,
      claim: first.claim,
      statusCode: 201,
      responseBody: { ok: true },
    });
    const replay = await claimIdempotencyKey({ route, key, requestHash });
    vi.setSystemTime(new Date("2026-05-30T10:00:01.000Z"));
    const afterRetention = await claimIdempotencyKey({ route, key, requestHash });

    expect(replay.kind).toBe("replay");
    expect(afterRetention.kind).toBe("fresh");
  });

  it("hashes undefined values deterministically", () => {
    expect(() => hashIdempotencyPayload({ optional: undefined })).not.toThrow();
    expect(hashIdempotencyPayload({ optional: undefined })).toBe(
      hashIdempotencyPayload({ optional: undefined }),
    );
  });
});
