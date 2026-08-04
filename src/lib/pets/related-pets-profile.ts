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
const VISUAL_REVISION =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1";
const CALIBRATION_REVISION = "search-eval-related-groups-v1";
const textDefinition = PET_SEARCH_MODEL_REVISIONS[TEXT_REVISION];
const visualDefinition = PET_VISUAL_MODEL_REVISIONS[VISUAL_REVISION];
const PINNED_CALIBRATED_PROFILE = {
  textMinSimilarity: 1.0000000000000002,
  visualMinSimilarity: 0.8537168126311578,
  visualWeight: 0.25,
} as const;

export const CURRENT_RELATED_PETS_RANKING_PROFILE = {
  rankingRevision: `related-pets-rrf60-v3:cal=${CALIBRATION_REVISION}:text=${TEXT_REVISION}:visual=${VISUAL_REVISION}`,
  textRevision: TEXT_REVISION,
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
  textDimensions: number;
  textWeight: number;
  metadataWeight: number;
  visualRevision: string;
  visualDimensions: number;
  rrfK: number;
};

export function isCurrentRelatedPetsRankingRevision(
  value: string,
): boolean {
  return value === CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision;
}
