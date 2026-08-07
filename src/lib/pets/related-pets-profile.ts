import {
  PET_SEARCH_EMBEDDING_MODELS,
  PET_SEARCH_MODEL_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
} from "@/lib/pets/search-config";
import {
  RELATED_PETS_METADATA_WEIGHT,
  RELATED_PETS_RRF_K,
  RELATED_PETS_TEXT_WEIGHT,
  type RelatedPetsRankingProfile,
} from "@/lib/pets/related-pets-ranking";

const TEXT_REVISION = "yandex-text-embeddings-v2-768-2026-07";
export const RELATED_PETS_TEXT_QUERY_REVISION =
  "yandex-text-embeddings-v2-768-related-tags-query-2026-08";
const VISUAL_REVISION =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1";
const CALIBRATION_REVISION = "related-pets-eval-groups-v2";
const textDefinition = PET_SEARCH_MODEL_REVISIONS[TEXT_REVISION];
const visualDefinition = PET_VISUAL_MODEL_REVISIONS[VISUAL_REVISION];
const PINNED_CALIBRATED_PROFILE = {
  textMinSimilarity: 0.4523258982119597,
  visualMinSimilarity: 0.7573239783550058,
  visualWeight: 0.5,
} as const;

export const RELATED_PETS_V1_RANKING_PROFILE = {
  rankingRevision: `related-pets-rrf60-v5:cal=${CALIBRATION_REVISION}:text=${TEXT_REVISION}:text-query=${RELATED_PETS_TEXT_QUERY_REVISION}:visual=${VISUAL_REVISION}`,
  textRevision: TEXT_REVISION,
  textQueryRevision: RELATED_PETS_TEXT_QUERY_REVISION,
  textDimensions:
    PET_SEARCH_EMBEDDING_MODELS[textDefinition.embeddingModelId].dimensions,
  textMinSimilarity: PINNED_CALIBRATED_PROFILE.textMinSimilarity,
  textWeight: RELATED_PETS_TEXT_WEIGHT,
  metadataWeight: RELATED_PETS_METADATA_WEIGHT,
  visualRevision: VISUAL_REVISION,
  visualDimensions:
    PET_SEARCH_EMBEDDING_MODELS[visualDefinition.embeddingModelId].dimensions,
  visualMinSimilarity:
    PINNED_CALIBRATED_PROFILE.visualMinSimilarity,
  visualWeight: PINNED_CALIBRATED_PROFILE.visualWeight,
  rrfK: RELATED_PETS_RRF_K,
} as const satisfies RelatedPetsRankingProfile & {
  rankingRevision: string;
  textRevision: string;
  textQueryRevision: string;
  textDimensions: number;
  textWeight: number;
  metadataWeight: number;
  visualRevision: string;
  visualDimensions: number;
  rrfK: number;
};

export const CURRENT_RELATED_PETS_RANKING_PROFILE =
  RELATED_PETS_V1_RANKING_PROFILE;

export function isCurrentRelatedPetsRankingRevision(
  value: string,
): boolean {
  return value === CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision;
}
