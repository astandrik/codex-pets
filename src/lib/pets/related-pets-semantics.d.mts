import type { PetKind } from "@/lib/pets/types";

export type RelatedPetDescriptionInput = {
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
};

export const RELATED_PETS_DESCRIPTION_QUERY_REVISION: string;
export const RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION: string;
export function normalizeRelatedPetTopicTags(
  tags: readonly string[],
): string[];

export function buildRelatedPetDescriptionText(
  pet: RelatedPetDescriptionInput,
): string;
