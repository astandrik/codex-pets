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
const textDefinition = PET_SEARCH_MODEL_REVISIONS[TEXT_REVISION];
const visualDefinition = PET_VISUAL_MODEL_REVISIONS[VISUAL_REVISION];

export const CURRENT_RELATED_PETS_RANKING_PROFILE = {
  rankingRevision:
    "related-pets-rrf60-v1:text=yandex-text-embeddings-v2-768-2026-07:visual=yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1",
  textRevision: TEXT_REVISION,
  textDimensions:
    PET_SEARCH_EMBEDDING_MODELS[textDefinition.embeddingModelId].dimensions,
  textMinSimilarity: textDefinition.minSemanticScore,
  textWeight: RELATED_PETS_TEXT_WEIGHT,
  metadataWeight: RELATED_PETS_METADATA_WEIGHT,
  visualRevision: VISUAL_REVISION,
  visualDimensions:
    PET_SEARCH_EMBEDDING_MODELS[visualDefinition.embeddingModelId].dimensions,
  visualMinSimilarity: visualDefinition.profile.minSemanticScore,
  visualWeight: visualDefinition.profile.weight,
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
