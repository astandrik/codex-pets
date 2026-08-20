export const RELATED_PETS_DESCRIPTION_QUERY_REVISION =
  "yandex-text-embeddings-v2-768-related-description-query-2026-08-v3";
export const RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION =
  "yandex-text-embeddings-v2-768-related-description-document-2026-08-v1";

export function buildRelatedPetDescriptionText(pet) {
  return [
    `name: ${pet.displayName.normalize("NFKC").trim()}`,
    `kind: ${pet.kind}`,
    `description: ${pet.description.normalize("NFKC").trim()}`,
  ].join("\n");
}
