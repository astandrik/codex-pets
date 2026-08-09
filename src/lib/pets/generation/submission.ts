import JSZip from "jszip";

import { storePetAssetsInYdb } from "@/lib/pets/assets-repository";
import { getGenerationRequestById } from "@/lib/pets/generation-requests-repository";
import {
  getGenerationRunById,
  readGenerationArtifact,
  transitionGenerationRun,
} from "@/lib/pets/generation/repository";
import type { PetGenerationFinalMetadata, PetGenerationRun } from "@/lib/pets/generation/types";
import { validateUploadedPackage } from "@/lib/pets/package";
import { createPendingPet } from "@/lib/pets/repository";
import type { PetJson } from "@/lib/pets/validation";

export type SubmitGenerationRunResult =
  | { ok: true; run: PetGenerationRun }
  | { ok: false; error: "not_found" | "conflict" | "invalid_package"; message: string };

export async function submitGenerationRun(input: {
  runId: string;
  approvedBy: string;
  metadata: PetGenerationFinalMetadata;
}): Promise<SubmitGenerationRunResult> {
  let run = await getGenerationRunById(input.runId);
  if (!run) return { ok: false, error: "not_found", message: "Generation run was not found." };
  if (run.status === "awaiting_moderation") return sameFinalMetadata(run.finalMetadata, input.metadata)
    ? { ok: true, run }
    : { ok: false, error: "conflict", message: "Final metadata differs from the submitted values." };
  if (run.status !== "awaiting_final_review" && run.status !== "submitting") {
    return { ok: false, error: "conflict", message: "Run is not awaiting final review." };
  }
  if (run.status === "awaiting_final_review") {
    const changed = await transitionGenerationRun({
      runId: run.id,
      status: "submitting",
      lastStage: "submission",
      finalMetadata: input.metadata,
      approvedBy: input.approvedBy,
    });
    if (!changed.ok) return changed;
    run = changed.run;
  }
  const metadata = run.finalMetadata;
  if (!metadata || !sameFinalMetadata(metadata, input.metadata)) {
    return { ok: false, error: "conflict", message: "Final metadata differs from the submitted values." };
  }

  const [request, spritesheet] = await Promise.all([
    getGenerationRequestById(run.requestId),
    readGenerationArtifact({ runId: run.id, key: "spritesheet" }),
  ]);
  if (!request) return { ok: false, error: "not_found", message: "Generation request was not found." };
  if (!["pending", "in_progress"].includes(request.status)) {
    return { ok: false, error: "conflict", message: "Generation request is already closed." };
  }
  if (!spritesheet) {
    return { ok: false, error: "invalid_package", message: "Required final artifacts are missing." };
  }
  if (spritesheet.metadata.contentType !== "image/webp") {
    return { ok: false, error: "invalid_package", message: "Final spritesheet must be WebP." };
  }
  const petJson: PetJson = {
    id: metadata.id,
    displayName: metadata.displayName,
    description: metadata.description,
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
  };
  const petJsonBuffer = Buffer.from(`${JSON.stringify(petJson, null, 2)}\n`, "utf8");
  const zip = new JSZip();
  zip.file("pet.json", petJsonBuffer);
  zip.file("spritesheet.webp", spritesheet.buffer);
  const zipBuffer = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 },
  });
  const validation = await validateUploadedPackage({
    petJsonBuffer,
    spritesheetBuffer: spritesheet.buffer,
    zipBuffer,
    spritesheetExt: "webp",
  });
  if (!validation.ok) return { ok: false, error: "invalid_package", message: validation.message };
  const assetId = deterministicAssetId(run.id);
  const urls = await storePetAssetsInYdb({
    assetId,
    petJsonBuffer,
    spritesheetBuffer: spritesheet.buffer,
    zipBuffer,
    spritesheetExt: "webp",
  });
  const pet = await createPendingPet({
    deterministicPetId: deterministicPetId(run.id),
    petJson: validation.value.petJson,
    ownerId: request.requesterUserId ?? "",
    ownerEmail: request.contactEmail,
    ownerName: request.requesterName,
    contactEmail: request.contactEmail,
    kind: metadata.kind,
    tags: metadata.tags,
    zipUrl: urls.zipUrl,
    petJsonUrl: urls.petJsonUrl,
    spritesheetUrl: urls.spritesheetUrl,
    spritesheetExt: "webp",
  });
  const transitioned = await transitionGenerationRun({
    runId: run.id,
    status: "awaiting_moderation",
    finalMetadata: metadata,
    finalPetId: pet.id,
    finalPetSlug: pet.slug,
    approvedBy: input.approvedBy,
  });
  if (transitioned.ok) return transitioned;
  const replay = await getGenerationRunById(run.id);
  return replay?.status === "awaiting_moderation"
    ? { ok: true, run: replay }
    : transitioned;
}

export function deterministicPetId(runId: string): string {
  return `pet_gen_${runId.replace(/^run_/, "").slice(0, 22)}`;
}
export function deterministicAssetId(runId: string): string {
  return `asset_gen_${runId.replace(/^run_/, "").slice(0, 22)}`;
}

function sameFinalMetadata(
  stored: PetGenerationFinalMetadata | null,
  received: PetGenerationFinalMetadata,
): boolean {
  return stored !== null && stored.id === received.id && stored.displayName === received.displayName &&
    stored.description === received.description && stored.kind === received.kind &&
    JSON.stringify(stored.tags) === JSON.stringify(received.tags);
}
