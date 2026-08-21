import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  PET_GENERATION_ARTIFACT_CHUNK_BYTES,
  chunkGenerationArtifact,
  reassembleGenerationArtifact,
  sha256,
} from "@/lib/pets/generation/artifact-chunks";
import { getPetGenerationConfig } from "@/lib/pets/generation/config";
import { validateGenerationFinalMetadata } from "@/lib/pets/generation/final-metadata";
import { detectReferenceImageType, normalizeGenerationReference } from "@/lib/pets/generation/input";
import { providerFailureDecision } from "@/lib/pets/generation/retry-policy";
import { canTransitionGenerationRun, retryStatusForStage } from "@/lib/pets/generation/state-machine";

describe("pet generation contracts", () => {
  it("keeps the feature disabled with bounded pilot defaults", () => {
    expect(getPetGenerationConfig({} as NodeJS.ProcessEnv)).toEqual({
      enabled: false,
      model: "gpt-image-2-2026-04-21",
      reviewModel: "gpt-5.6-sol",
      maxImageCalls: 15,
      artifactRetentionDays: 14,
      leaseSeconds: 120,
    });
  });

  it("allows only declared run transitions and retries the failed scope", () => {
    expect(canTransitionGenerationRun("queued_base", "generating_base")).toBe(true);
    expect(canTransitionGenerationRun("queued_base", "awaiting_final_review")).toBe(false);
    expect(canTransitionGenerationRun("awaiting_moderation", "completed")).toBe(true);
    expect(canTransitionGenerationRun("completed", "submission_rejected")).toBe(true);
    expect(retryStatusForStage("base")).toBe("queued_base");
    expect(retryStatusForStage("running-left")).toBe("queued_hatch");
  });

  it("chunks at 4 MiB and rejects size or SHA corruption", () => {
    const buffer = Buffer.alloc(PET_GENERATION_ARTIFACT_CHUNK_BYTES + 17, 7);
    const chunks = chunkGenerationArtifact(buffer);
    expect(chunks.map((chunk) => chunk.length)).toEqual([PET_GENERATION_ARTIFACT_CHUNK_BYTES, 17]);
    expect(sha256(reassembleGenerationArtifact({ chunks, expectedSize: buffer.length, expectedSha256: sha256(buffer) })))
      .toBe(sha256(buffer));
    expect(() => reassembleGenerationArtifact({ chunks, expectedSize: buffer.length, expectedSha256: "0".repeat(64) }))
      .toThrow("SHA-256");
  });

  it("retries only explicit 408/429/5xx responses twice and never an ambiguous loss", () => {
    expect(providerFailureDecision({ status: 429, responseReceived: true }, 0)).toEqual({ kind: "retry", delayMs: 1_000 });
    expect(providerFailureDecision({ status: 503, responseReceived: true }, 1)).toEqual({ kind: "retry", delayMs: 2_000 });
    expect(providerFailureDecision({ status: 503, responseReceived: true }, 2)).toEqual({ kind: "fail", ambiguous: false });
    expect(providerFailureDecision({ status: null, responseReceived: false }, 0)).toEqual({ kind: "fail", ambiguous: true });
  });

  it("normalizes a valid uploaded reference to metadata-free PNG", async () => {
    const jpeg = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "red" },
    }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect(detectReferenceImageType(jpeg)).toBe("image/jpeg");
    const normalized = await normalizeGenerationReference({ buffer: jpeg, declaredContentType: "image/jpeg" });
    expect(normalized.contentType).toBe("image/png");
    expect({ width: normalized.width, height: normalized.height }).toEqual({ width: 24, height: 32 });
    expect(detectReferenceImageType(normalized.buffer)).toBe("image/png");
    const metadata = await sharp(normalized.buffer).metadata();
    expect(metadata.orientation).toBeUndefined();
    await expect(normalizeGenerationReference({ buffer: jpeg, declaredContentType: "image/png" }))
      .rejects.toThrow("does not match");
  });

  it("validates the final moderator-owned pet metadata", () => {
    expect(validateGenerationFinalMetadata({
      id: "pilot-otter", displayName: "Pilot Otter", description: "A focused pet.",
      kind: "creature", tags: ["focused", "pilot"],
    })).toMatchObject({ ok: true, value: { id: "pilot-otter", kind: "creature" } });
    expect(validateGenerationFinalMetadata({ id: "", displayName: "x", description: "x", tags: [] }))
      .toMatchObject({ ok: false, field: "id" });
  });
});
