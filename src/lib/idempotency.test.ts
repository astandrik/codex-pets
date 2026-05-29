import { describe, expect, it, vi } from "vitest";

import {
  claimIdempotencyKey,
  hashIdempotencyPayload,
  storeIdempotencyResult,
} from "@/lib/idempotency";

describe("idempotency helpers", () => {
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

  it("hashes undefined values deterministically", () => {
    expect(() => hashIdempotencyPayload({ optional: undefined })).not.toThrow();
    expect(hashIdempotencyPayload({ optional: undefined })).toBe(
      hashIdempotencyPayload({ optional: undefined }),
    );
  });
});
