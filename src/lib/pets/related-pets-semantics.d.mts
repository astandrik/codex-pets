import type { PetKind } from "@/lib/pets/types";

export type RelatedPetThemeInput = {
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
};

export const RELATED_PETS_THEME_QUERY_REVISION: string;

export function normalizeRelatedPetSemanticTags(
  tags: readonly string[],
): string[];

export function buildRelatedPetThemeQuery(
  pet: RelatedPetThemeInput,
): string;
