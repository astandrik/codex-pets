import { afterEach, describe, expect, it, vi } from "vitest";

import { createGenerationRequest } from "@/lib/pets/generation-requests-repository";
import { createGenerationRun } from "@/lib/pets/generation/repository";

describe("generation run idempotency", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("replays the same key and rejects a competing active run", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const request = await createGenerationRequest({
      contactEmail: `pilot-${crypto.randomUUID()}@example.com`,
      requesterName: "Pilot",
      requesterUserId: null,
      displayNameHint: "Pilot pet",
      prompt: "Create a compact test pet.",
      kind: "creature",
      referenceImage: null,
    });

    const first = await createGenerationRun({ requestId: request.id, idempotencyKey: "same-key" });
    const replay = await createGenerationRun({ requestId: request.id, idempotencyKey: "same-key" });
    const competing = await createGenerationRun({ requestId: request.id, idempotencyKey: "different-key" });

    expect(first.ok).toBe(true);
    expect(replay).toEqual(first);
    expect(competing).toMatchObject({ ok: false, error: "conflict" });
  });
});
