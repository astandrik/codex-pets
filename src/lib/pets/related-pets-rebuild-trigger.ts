import {
  invalidateRelatedPets,
  rebuildRelatedPets,
} from "@/lib/pets/related-pets-rebuild";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-v24-profile";
import type { PetSearchSemanticConfig } from "@/lib/pets/search-config";
import { petSearchRuntimeConfig } from "@/lib/pets/search-provider-runtime";

type RelatedPetsRebuildTrigger =
  | "approve-text"
  | "approve-visual"
  | "reject"
  | "admin-delete"
  | "owner-delete";

export function isRelatedPetsTextRefreshCompatible(
  semanticConfig: Pick<
    PetSearchSemanticConfig,
    "revision" | "dimensions"
  > | null,
): boolean {
  return (
    semanticConfig?.revision ===
      RELATED_PETS_V24_PROFILE.embeddingRevision &&
    semanticConfig.dimensions ===
      RELATED_PETS_V24_PROFILE.textDimensions
  );
}

export async function rebuildRelatedPetsBestEffort(input: {
  trigger: RelatedPetsRebuildTrigger;
  includeVisual: boolean;
}): Promise<boolean> {
  if (
    !isRelatedPetsTextRefreshCompatible(petSearchRuntimeConfig.semantic)
  ) {
    return invalidateRelatedPetsBestEffort({
      trigger: input.trigger,
      reason: "text-profile-incompatible",
    });
  }

  try {
    await rebuildRelatedPets({
      mode: "apply",
      includeVisual: input.includeVisual,
    });
    return true;
  } catch {
    console.warn("[codex-pets][related-pets-rebuild-trigger]", {
      operation: "rebuild",
      trigger: input.trigger,
      status: "failed",
      includeVisual: input.includeVisual,
    });
    return false;
  }
}

export async function invalidateRelatedPetsBestEffort(input: {
  trigger: RelatedPetsRebuildTrigger;
  reason: "text-profile-incompatible";
}): Promise<boolean> {
  try {
    await invalidateRelatedPets({
      failureReason: "text_profile_incompatible",
    });
    return true;
  } catch {
    console.warn("[codex-pets][related-pets-rebuild-trigger]", {
      operation: "invalidate",
      trigger: input.trigger,
      status: "failed",
      reason: input.reason,
    });
    return false;
  }
}
