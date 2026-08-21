import { afterEach, describe, expect, it, vi } from "vitest";

import { createGenerationRequest } from "@/lib/pets/generation-requests-repository";
import {
  approveGenerationBase,
  createGenerationRun,
  regenerateGenerationBase,
  transitionGenerationRun,
} from "@/lib/pets/generation/repository";

describe("generation run idempotency", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it("replays the same key and rejects a competing active run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-09T10:00:00.000Z"));
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
    if (!first.ok) return;
    await transitionGenerationRun({ runId: first.run.id, status: "generating_base" });
    await transitionGenerationRun({ runId: first.run.id, status: "awaiting_base_review" });

    const results = await Promise.all([
      approveGenerationBase(first.run.id),
      regenerateGenerationBase(first.run.id),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
  });
});
