import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createGenerationRequest, getGenerationRequestById } from "@/lib/pets/generation-requests-repository";
import {
  completeGeneratedPetModeration,
  createGenerationRun,
  getGenerationRunById,
  reopenGeneratedPetRequest,
  storeGenerationArtifact,
  transitionGenerationRun,
} from "@/lib/pets/generation/repository";
import { deterministicPetId, submitGenerationRun } from "@/lib/pets/generation/submission";
import { listPendingPets } from "@/lib/pets/repository";

describe("final generation submission", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("revalidates a v2 package and creates one deterministic pending pet on replay", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const request = await createGenerationRequest({
      contactEmail: `submission-${crypto.randomUUID()}@example.com`,
      requesterName: "Pilot",
      requesterUserId: null,
      displayNameHint: "Submission pet",
      prompt: "Create a compact submission pet.",
      kind: "creature",
      referenceImage: null,
    });
    const created = await createGenerationRun({ requestId: request.id, idempotencyKey: "submit-run" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const runId = created.run.id;
    for (const [status, lastStage] of [
      ["generating_base", "base"], ["awaiting_base_review", "base"], ["queued_hatch", "base"],
      ["generating", "assembly"], ["validating", "assembly"], ["awaiting_final_review", "vision-review"],
    ] as const) {
      const changed = await transitionGenerationRun({ runId, status, lastStage });
      expect(changed.ok).toBe(true);
    }
    const spritesheet = await sharp({
      create: { width: 1536, height: 2288, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).webp({ lossless: true }).toBuffer();
    await storeGenerationArtifact({
      runId, key: "spritesheet", stage: "assembly", fileName: "spritesheet.webp",
      contentType: "image/webp", buffer: spritesheet,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const metadata = {
      id: `generated-${crypto.randomUUID().slice(0, 8)}`,
      displayName: "Generated Pilot",
      description: "A generated v2 pilot pet.",
      kind: "creature" as const,
      tags: ["pilot"],
    };

    const first = await submitGenerationRun({ runId, approvedBy: "admin", metadata });
    const replay = await submitGenerationRun({ runId, approvedBy: "admin", metadata });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(first.run.status).toBe("awaiting_moderation");
    expect(replay.run.finalPetId).toBe(deterministicPetId(runId));
    expect((await listPendingPets()).filter((pet) => pet.id === deterministicPetId(runId))).toHaveLength(1);

    await completeGeneratedPetModeration({ petId: deterministicPetId(runId), petSlug: first.run.finalPetSlug! });
    expect(await getGenerationRequestById(request.id)).toMatchObject({ status: "fulfilled" });
    expect(await getGenerationRunById(runId)).toMatchObject({ status: "completed" });

    await reopenGeneratedPetRequest(deterministicPetId(runId));
    expect(await getGenerationRequestById(request.id)).toMatchObject({ status: "pending", linkedPetId: null });
    expect(await getGenerationRunById(runId)).toMatchObject({ status: "submission_rejected" });
  });
});
