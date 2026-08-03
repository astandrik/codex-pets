import { rebuildRelatedPets } from "@/lib/pets/related-pets-rebuild";

type RelatedPetsRebuildTrigger =
  | "approve-text"
  | "approve-visual"
  | "reject"
  | "admin-delete"
  | "owner-delete";

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
