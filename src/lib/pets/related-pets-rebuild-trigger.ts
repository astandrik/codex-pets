import {
  invalidateRelatedPets,
  rebuildRelatedPets,
} from "@/lib/pets/related-pets-rebuild";
import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import type { PetSearchSemanticConfig } from "@/lib/pets/search-config";

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
      CURRENT_RELATED_PETS_RANKING_PROFILE.textRevision &&
    semanticConfig.dimensions ===
      CURRENT_RELATED_PETS_RANKING_PROFILE.textDimensions
  );
}

export async function rebuildRelatedPetsBestEffort(input: {
  trigger: RelatedPetsRebuildTrigger;
  includeVisual: boolean;
}): Promise<boolean> {
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
  trigger: "approve-text";
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
