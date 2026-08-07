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
const V2_VISUAL_REVISION =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v2";
const CALIBRATION_REVISION = "related-pets-eval-groups-v2";
const textDefinition = PET_SEARCH_MODEL_REVISIONS[TEXT_REVISION];
const visualDefinition = PET_VISUAL_MODEL_REVISIONS[VISUAL_REVISION];
const v2VisualDefinition = PET_VISUAL_MODEL_REVISIONS[V2_VISUAL_REVISION];
const V1_PINNED_CALIBRATED_PROFILE = {
  textMinSimilarity: 0.4523258982119597,
  visualMinSimilarity: 0.7573239783550058,
  visualWeight: 0.5,
} as const;
const V2_PINNED_CALIBRATED_PROFILE = {
  textMinSimilarity: 0.4523258982119597,
  visualMinSimilarity: 0.6766062714106664,
  visualWeight: 0.5,
} as const;

export const RELATED_PETS_V1_RANKING_PROFILE = {
  rankingRevision: `related-pets-rrf60-v5:cal=${CALIBRATION_REVISION}:text=${TEXT_REVISION}:text-query=${RELATED_PETS_TEXT_QUERY_REVISION}:visual=${VISUAL_REVISION}`,
  textRevision: TEXT_REVISION,
  textQueryRevision: RELATED_PETS_TEXT_QUERY_REVISION,
  textDimensions:
    PET_SEARCH_EMBEDDING_MODELS[textDefinition.embeddingModelId].dimensions,
  textMinSimilarity: V1_PINNED_CALIBRATED_PROFILE.textMinSimilarity,
  textWeight: RELATED_PETS_TEXT_WEIGHT,
  metadataWeight: RELATED_PETS_METADATA_WEIGHT,
  visualRevision: VISUAL_REVISION,
  visualDimensions:
    PET_SEARCH_EMBEDDING_MODELS[visualDefinition.embeddingModelId].dimensions,
  visualMinSimilarity:
    V1_PINNED_CALIBRATED_PROFILE.visualMinSimilarity,
  visualWeight: V1_PINNED_CALIBRATED_PROFILE.visualWeight,
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

export const RELATED_PETS_V2_RANKING_PROFILE = {
  rankingRevision: `related-pets-rrf60-v6:cal=${CALIBRATION_REVISION}:text=${TEXT_REVISION}:text-query=${RELATED_PETS_TEXT_QUERY_REVISION}:visual=${V2_VISUAL_REVISION}`,
  textRevision: TEXT_REVISION,
  textQueryRevision: RELATED_PETS_TEXT_QUERY_REVISION,
  textDimensions:
    PET_SEARCH_EMBEDDING_MODELS[textDefinition.embeddingModelId].dimensions,
  textMinSimilarity: V2_PINNED_CALIBRATED_PROFILE.textMinSimilarity,
  textWeight: RELATED_PETS_TEXT_WEIGHT,
  metadataWeight: RELATED_PETS_METADATA_WEIGHT,
  visualRevision: V2_VISUAL_REVISION,
  visualDimensions:
    PET_SEARCH_EMBEDDING_MODELS[v2VisualDefinition.embeddingModelId].dimensions,
  visualMinSimilarity: V2_PINNED_CALIBRATED_PROFILE.visualMinSimilarity,
  visualWeight: V2_PINNED_CALIBRATED_PROFILE.visualWeight,
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
  RELATED_PETS_V2_RANKING_PROFILE;

export function isCurrentRelatedPetsRankingRevision(
  value: string,
): boolean {
  return value === CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision;
}
