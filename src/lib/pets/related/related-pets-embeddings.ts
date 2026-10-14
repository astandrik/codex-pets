import { createHash } from "node:crypto";
import {
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  RELATED_PETS_DESCRIPTION_QUERY_REVISION,
  buildRelatedPetDescriptionText,
} from "@/lib/pets/related/related-pets-semantics.mjs";
import { OPENAI_PETS_REVISIONS } from "@/lib/pets/openai-embedding-profile";
import { buildPetSearchDocument, normalizedPetTags, type PetSearchDocumentInput } from "@/lib/pets/search/search-embeddings";

export function buildRelatedPetQuery(
  pet: PetSearchDocumentInput,
  modelRevision: string,
): string {
  if (modelRevision === RELATED_PETS_DESCRIPTION_QUERY_REVISION ||
      modelRevision === OPENAI_PETS_REVISIONS.descriptionQuery) {
    return buildRelatedPetDescriptionText(pet);
  }
  const tags = normalizedPetTags(pet.tags);
  return tags.length > 0
    ? tags.join(" ")
    : pet.description.normalize("NFKC").trim();
}

export function buildRelatedPetDocument(
  pet: PetSearchDocumentInput,
  modelRevision: string,
): string {
  if (modelRevision === RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION ||
      modelRevision === OPENAI_PETS_REVISIONS.descriptionDocument) {
    return buildRelatedPetDescriptionText(pet);
  }
  return buildPetSearchDocument(pet);
}

export function createRelatedPetQuerySourceHash(
  pet: PetSearchDocumentInput,
  modelRevision: string,
): string {
  return createHash("sha256")
    .update(modelRevision)
    .update("\n")
    .update(buildRelatedPetQuery(pet, modelRevision))
    .digest("hex");
}

export function createRelatedPetDocumentSourceHash(
  pet: PetSearchDocumentInput,
  modelRevision: string,
): string {
  return createHash("sha256")
    .update(modelRevision)
    .update("\n")
    .update(buildRelatedPetDocument(pet, modelRevision))
    .digest("hex");
}
