import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGenerationRequest,
  getGenerationRequestById,
  rejectGenerationRequest,
} from "@/lib/pets/generation-requests-repository";
import {
  completeGeneratedPetModeration,
  createGenerationRun,
  getGenerationRunById,
  reopenGeneratedPetRequest,
  storeGenerationArtifact,
  transitionGenerationRun,
} from "@/lib/pets/generation/repository";
import { deterministicAssetId, deterministicPetId, submitGenerationRun } from "@/lib/pets/generation/submission";
import { readPetAssetFile } from "@/lib/pets/assets-repository";
import { createPendingPet, listPendingPets } from "@/lib/pets/repository";

describe("final generation submission", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("revalidates a v2 package and creates one deterministic pending pet on replay", async () => {
    const { runId, requestId, metadata } = await readyRun("submit-run");

    const first = await submitGenerationRun({ runId, approvedBy: "admin", metadata });
    const replay = await submitGenerationRun({ runId, approvedBy: "admin", metadata });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    if (!first.ok || !replay.ok) return;
    expect(first.run.status).toBe("awaiting_moderation");
    expect(replay.run.finalPetId).toBe(deterministicPetId(runId));
    expect((await listPendingPets()).filter((pet) => pet.id === deterministicPetId(runId))).toHaveLength(1);

    await completeGeneratedPetModeration({ petId: deterministicPetId(runId), petSlug: first.run.finalPetSlug! });
    expect(await getGenerationRequestById(requestId)).toMatchObject({ status: "fulfilled" });
    expect(await getGenerationRunById(runId)).toMatchObject({ status: "completed" });

    await reopenGeneratedPetRequest(deterministicPetId(runId));
    expect(await getGenerationRequestById(requestId)).toMatchObject({ status: "pending", linkedPetId: null });
    expect(await getGenerationRunById(runId)).toMatchObject({ status: "submission_rejected" });
  });

  it("allows only one of two concurrent submissions with different metadata", async () => {
    const { runId, metadata } = await readyRun("metadata-replay");
    const results = await Promise.all([
      submitGenerationRun({ runId, approvedBy: "admin", metadata }),
      submitGenerationRun({ runId, approvedBy: "admin", metadata: { ...metadata, id: `${metadata.id}-different` } }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.error === "conflict")).toHaveLength(1);
    expect((await listPendingPets()).filter((pet) => pet.id === deterministicPetId(runId))).toHaveLength(1);

    const canonical = (await getGenerationRunById(runId))!.finalMetadata!;
    const replay = await submitGenerationRun({ runId, approvedBy: "admin", metadata: canonical });
    expect(replay).toMatchObject({ ok: true, run: { status: "awaiting_moderation" } });
  });

  it("recovers an unlinked pending pet during approval and rejection", async () => {
    const approved = await unlinkedPendingPet("recover-approve");
    await completeGeneratedPetModeration({ petId: deterministicPetId(approved.runId), petSlug: approved.petSlug });
    expect(await getGenerationRequestById(approved.requestId)).toMatchObject({ status: "fulfilled" });
    expect(await getGenerationRunById(approved.runId)).toMatchObject({ status: "completed" });

    const rejected = await unlinkedPendingPet("recover-reject");
    await reopenGeneratedPetRequest(deterministicPetId(rejected.runId));
    expect(await getGenerationRequestById(rejected.requestId)).toMatchObject({ status: "pending" });
    expect(await getGenerationRunById(rejected.runId)).toMatchObject({ status: "submission_rejected" });

    const closed = await unlinkedPendingPet("recover-closed");
    await rejectGenerationRequest({ requestId: closed.requestId });
    await completeGeneratedPetModeration({ petId: deterministicPetId(closed.runId), petSlug: closed.petSlug });
    expect(await getGenerationRequestById(closed.requestId)).toMatchObject({ status: "rejected" });
    expect(await getGenerationRunById(closed.runId)).toMatchObject({ status: "submission_rejected" });
  });

  it("does not submit a pet after the source request is closed", async () => {
    const { runId, requestId, metadata } = await readyRun("closed-request");
    await rejectGenerationRequest({ requestId });

    const result = await submitGenerationRun({ runId, approvedBy: "admin", metadata });

    expect(result).toMatchObject({ ok: false, error: "conflict" });
    expect((await listPendingPets()).some((pet) => pet.id === deterministicPetId(runId))).toBe(false);
    await expect(readPetAssetFile({ assetId: deterministicAssetId(runId), filename: "pet.json" })).rejects.toThrow();
  });
});

async function readyRun(label: string) {
  vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
  const request = await createGenerationRequest({
    contactEmail: `${label}-${crypto.randomUUID()}@example.com`,
    requesterName: "Pilot", requesterUserId: null, displayNameHint: "Submission pet",
    prompt: "Create a compact submission pet.",
    kind: "creature", referenceImage: null,
  });
  const created = await createGenerationRun({ requestId: request.id, idempotencyKey: label });
  if (!created.ok) throw new Error(created.message);
  for (const [status, lastStage] of [
    ["generating_base", "base"], ["awaiting_base_review", "base"], ["queued_hatch", "base"],
    ["generating", "assembly"], ["validating", "assembly"], ["awaiting_final_review", "vision-review"],
  ] as const) {
    const changed = await transitionGenerationRun({ runId: created.run.id, status, lastStage });
    if (!changed.ok) throw new Error(changed.message);
  }
  const spritesheet = await sharp({ create: {
    width: 1536, height: 2288, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 },
  } }).webp({ lossless: true }).toBuffer();
  await storeGenerationArtifact({
    runId: created.run.id, key: "spritesheet", stage: "assembly",
    fileName: "spritesheet.webp", contentType: "image/webp", buffer: spritesheet,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  return {
    runId: created.run.id,
    requestId: request.id,
    metadata: {
      id: `generated-${crypto.randomUUID().slice(0, 8)}`, displayName: "Generated Pilot",
      description: "A generated v2 pilot pet.", kind: "creature" as const, tags: ["pilot"],
    },
  };
}

async function unlinkedPendingPet(label: string) {
  const prepared = await readyRun(label);
  await transitionGenerationRun({
    runId: prepared.runId, status: "submitting", lastStage: "submission",
    finalMetadata: prepared.metadata, approvedBy: "admin",
  });
  const pet = await createPendingPet({
    deterministicPetId: deterministicPetId(prepared.runId),
    petJson: { ...prepared.metadata, spriteVersionNumber: 2, spritesheetPath: "spritesheet.webp" },
    ownerId: "", ownerEmail: `${label}@example.com`, ownerName: "Pilot",
    contactEmail: `${label}@example.com`, kind: prepared.metadata.kind, tags: prepared.metadata.tags,
    zipUrl: "/assets/test.zip", petJsonUrl: "/assets/pet.json",
    spritesheetUrl: "/assets/spritesheet.webp", spritesheetExt: "webp",
  });
  return { ...prepared, petSlug: pet.slug };
}
