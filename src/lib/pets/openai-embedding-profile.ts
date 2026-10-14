// Revisions describe both the provider and the input contract. Old rows remain readable.
export const OPENAI_EMBEDDING_MODEL = "text-embedding-3-large";
export const OPENAI_EMBEDDING_DIMENSIONS = 3072;
const PREFIX = "openai-text-embedding-3-large-3072-pets-20261011-v1";
export const OPENAI_PETS_REVISIONS = {
  search: `${PREFIX}-search-document`,
  descriptionDocument: `${PREFIX}-description-document`,
  descriptionQuery: `${PREFIX}-description-query`,
  annotationDocument: `${PREFIX}-annotation-document`,
  annotationQuery: `${PREFIX}-annotation-query`,
  visual: `${PREFIX}-visual-caption-document`,
} as const;

// Frozen by docs/search/openai-pets-acceptance-20261011.json; calibration and holdout are separate.
export const OPENAI_PETS_CALIBRATION = {
  accepted: true,
  revision: "pets-openai-calibration-20261011-v1",
  searchMinSimilarity: 0.2,
  searchVisualMinSimilarity: 0.18,
  searchVisualWeight: 0.25,
  textMinSimilarity: 0.44,
  annotationMinSimilarity: 0.45,
  annotationWeight: 0.5,
  visualMinSimilarity: 0.66,
  visualWeight: 0.25,
};

export function isOpenAIPetsProfile(environment: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const profile = environment.PET_EMBEDDING_PROFILE?.trim();
  if (profile && profile !== "yandex-v24" && profile !== "openai-large-v1") {
    throw new Error("unsupported_pets_embedding_profile");
  }
  if (profile === "openai-large-v1" && !OPENAI_PETS_CALIBRATION.accepted) {
    throw new Error("openai_pets_calibration_not_accepted");
  }
  return profile === "openai-large-v1";
}
