export type RelatedPetDescriptionInput = {
  displayName: string;
  kind: string;
  description: string;
};

export const RELATED_PETS_DESCRIPTION_QUERY_REVISION: string;
export const RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION: string;
export function buildRelatedPetDescriptionText(
  pet: RelatedPetDescriptionInput,
): string;
