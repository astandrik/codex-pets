import {
  PET_SEARCH_EMBEDDING_MODELS,
  PET_SEARCH_MODEL_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
} from "@/lib/pets/search-config";
import {
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  RELATED_PETS_DESCRIPTION_QUERY_REVISION,
  RELATED_PETS_THEME_QUERY_REVISION,
  RELATED_PETS_TOPIC_DOCUMENT_REVISION,
  RELATED_PETS_TOPIC_QUERY_REVISION,
} from "@/lib/pets/related-pets-semantics.mjs";
import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  RELATED_PETS_METADATA_WEIGHT,
  RELATED_PETS_RRF_K,
  RELATED_PETS_TEXT_WEIGHT,
  type RelatedPetsRankingProfile,
} from "@/lib/pets/related-pets-ranking";

const TEXT_REVISION = "yandex-text-embeddings-v2-768-2026-07";
export const RELATED_PETS_V7_TEXT_QUERY_REVISION =
  "yandex-text-embeddings-v2-768-related-tags-query-2026-08";
export const RELATED_PETS_V8_TEXT_QUERY_REVISION =
  RELATED_PETS_THEME_QUERY_REVISION;
export const RELATED_PETS_V9_TEXT_QUERY_REVISION =
  RELATED_PETS_DESCRIPTION_QUERY_REVISION;
export const RELATED_PETS_V9_TEXT_DOCUMENT_REVISION =
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION;
export const RELATED_PETS_V10_TOPIC_QUERY_REVISION =
  RELATED_PETS_TOPIC_QUERY_REVISION;
export const RELATED_PETS_V10_TOPIC_DOCUMENT_REVISION =
  RELATED_PETS_TOPIC_DOCUMENT_REVISION;
const VISUAL_REVISION =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1";
const V7_CALIBRATION_REVISION = "related-pets-eval-groups-v2";
const V8_CALIBRATION_REVISION = "related-pets-eval-v3";
const V9_CALIBRATION_REVISION = "related-pets-eval-v4";
const V10_CALIBRATION_REVISION = "related-pets-eval-v5";
const V11_CALIBRATION_REVISION = "related-pets-eval-v7";
const textDefinition = PET_SEARCH_MODEL_REVISIONS[TEXT_REVISION];
const visualDefinition = PET_VISUAL_MODEL_REVISIONS[VISUAL_REVISION];
const PINNED_CALIBRATED_PROFILE = {
  textMinSimilarity: 0.4523258982119597,
  visualMinSimilarity: 0.7573239783550058,
  visualWeight: 0.5,
} as const;
const PINNED_V8_PROFILE = {
  textMinSimilarity: 0.45777065618272195,
  visualMinSimilarity: 0.7431592921968864,
  visualWeight: 0.75,
} as const;
const PINNED_V11_PROFILE = {
  textMinSimilarity: 0.6167421023517932,
  annotationMinSimilarity: 0.4133420129086638,
  annotationWeight: 1,
  visualMinSimilarity: 0.8178749331551675,
  visualWeight: 0.25,
} as const;

type RelatedPetsRuntimeProfile = RelatedPetsRankingProfile & {
  rankingRevision: string;
  embeddingRevision: string;
  textRevision: string;
  textQueryRevision: string;
  textDimensions: number;
  textWeight: number;
  metadataWeight: number;
  topicRevision?: string;
  topicQueryRevision?: string;
  topicDimensions?: number;
  topicMinSimilarity?: number;
  topicWeight?: number;
  annotationRevision?: string;
  annotationDocumentRevision?: string;
  annotationQueryRevision?: string;
  annotationDimensions?: number;
  annotationMinSimilarity?: number;
  annotationWeight?: number;
  visualRevision: string;
  visualDimensions: number;
  rrfK: number;
};

export const LEGACY_RELATED_PETS_V7_PROFILE = {
  strategy: "legacy-v7",
  rankingRevision: `related-pets-rrf60-v7:depth=8:tail=semantic:cal=${V7_CALIBRATION_REVISION}:text=${TEXT_REVISION}:text-query=${RELATED_PETS_V7_TEXT_QUERY_REVISION}:visual=${VISUAL_REVISION}`,
  embeddingRevision: TEXT_REVISION,
  textRevision: TEXT_REVISION,
  textQueryRevision: RELATED_PETS_V7_TEXT_QUERY_REVISION,
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
} as const satisfies RelatedPetsRuntimeProfile;

export const RELATED_PETS_V9_CALIBRATION_PROFILE = {
  ...LEGACY_RELATED_PETS_V7_PROFILE,
  strategy: "text-first-v9",
  rankingRevision: `related-pets-text-first-v9:depth=8:cal=${V9_CALIBRATION_REVISION}:embedding=${TEXT_REVISION}:text=${RELATED_PETS_V9_TEXT_DOCUMENT_REVISION}:text-query=${RELATED_PETS_V9_TEXT_QUERY_REVISION}:visual=${VISUAL_REVISION}:candidate`,
  textRevision: RELATED_PETS_V9_TEXT_DOCUMENT_REVISION,
  textQueryRevision: RELATED_PETS_V9_TEXT_QUERY_REVISION,
  textMinSimilarity: 0,
  visualMinSimilarity: null,
  visualWeight: 0,
} as const satisfies RelatedPetsRuntimeProfile;

// Replaced by the immutable calibrated profile in the separate pinning commit.
export const RELATED_PETS_V9_PROFILE =
  RELATED_PETS_V9_CALIBRATION_PROFILE;

export const RELATED_PETS_V10_CALIBRATION_PROFILE = {
  ...LEGACY_RELATED_PETS_V7_PROFILE,
  strategy: "description-theme-v10",
  rankingRevision: `related-pets-description-theme-v10:depth=8:cal=${V10_CALIBRATION_REVISION}:description=${RELATED_PETS_V9_TEXT_DOCUMENT_REVISION}:description-query=${RELATED_PETS_V9_TEXT_QUERY_REVISION}:topic=${RELATED_PETS_V10_TOPIC_DOCUMENT_REVISION}:topic-query=${RELATED_PETS_V10_TOPIC_QUERY_REVISION}:visual=${VISUAL_REVISION}:candidate`,
  textRevision: RELATED_PETS_V9_TEXT_DOCUMENT_REVISION,
  textQueryRevision: RELATED_PETS_V9_TEXT_QUERY_REVISION,
  textMinSimilarity: 0,
  metadataWeight: 0.05,
  topicRevision: RELATED_PETS_V10_TOPIC_DOCUMENT_REVISION,
  topicQueryRevision: RELATED_PETS_V10_TOPIC_QUERY_REVISION,
  topicDimensions:
    PET_SEARCH_EMBEDDING_MODELS[textDefinition.embeddingModelId].dimensions,
  topicMinSimilarity: 0,
  topicWeight: 0.1,
  visualMinSimilarity: null,
  visualWeight: 0,
} as const satisfies RelatedPetsRuntimeProfile;

// Replaced by the immutable calibrated profile in the separate pinning commit.
export const RELATED_PETS_V10_PROFILE =
  RELATED_PETS_V10_CALIBRATION_PROFILE;

export const RELATED_PETS_V11_CALIBRATION_PROFILE = {
  ...LEGACY_RELATED_PETS_V7_PROFILE,
  strategy: "entity-controlled-v11",
  rankingRevision: `related-pets-entity-controlled-v11-r3:depth=8:tail=description-first:gate=qualified-negatives:cal=${V11_CALIBRATION_REVISION}:description=${RELATED_PETS_V9_TEXT_DOCUMENT_REVISION}:description-query=${RELATED_PETS_V9_TEXT_QUERY_REVISION}:annotation=${RELATED_PETS_ANNOTATION_REVISION}:annotation-document=${RELATED_PETS_ANNOTATION_DOCUMENT_REVISION}:annotation-query=${RELATED_PETS_ANNOTATION_QUERY_REVISION}:visual=${VISUAL_REVISION}:candidate`,
  textRevision: RELATED_PETS_V9_TEXT_DOCUMENT_REVISION,
  textQueryRevision: RELATED_PETS_V9_TEXT_QUERY_REVISION,
  textMinSimilarity: 0,
  metadataWeight: 0,
  annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
  annotationDocumentRevision: RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  annotationQueryRevision: RELATED_PETS_ANNOTATION_QUERY_REVISION,
  annotationDimensions:
    PET_SEARCH_EMBEDDING_MODELS[textDefinition.embeddingModelId].dimensions,
  annotationMinSimilarity: 0,
  annotationWeight: 0.25,
  visualMinSimilarity: null,
  visualWeight: 0,
} as const satisfies RelatedPetsRuntimeProfile;

export const RELATED_PETS_V11_PROFILE = {
  ...RELATED_PETS_V11_CALIBRATION_PROFILE,
  rankingRevision: `related-pets-entity-controlled-v11-r3:depth=8:tail=description-first:gate=qualified-negatives:cal=${V11_CALIBRATION_REVISION}:text-min=${PINNED_V11_PROFILE.textMinSimilarity}:annotation-min=${PINNED_V11_PROFILE.annotationMinSimilarity}:annotation-weight=${PINNED_V11_PROFILE.annotationWeight}:visual-min=${PINNED_V11_PROFILE.visualMinSimilarity}:visual-weight=${PINNED_V11_PROFILE.visualWeight}:description=${RELATED_PETS_V9_TEXT_DOCUMENT_REVISION}:description-query=${RELATED_PETS_V9_TEXT_QUERY_REVISION}:annotation=${RELATED_PETS_ANNOTATION_REVISION}:annotation-document=${RELATED_PETS_ANNOTATION_DOCUMENT_REVISION}:annotation-query=${RELATED_PETS_ANNOTATION_QUERY_REVISION}:visual=${VISUAL_REVISION}`,
  ...PINNED_V11_PROFILE,
} as const satisfies RelatedPetsRuntimeProfile;

export const RELATED_PETS_V8_CALIBRATION_PROFILE = {
  ...LEGACY_RELATED_PETS_V7_PROFILE,
  strategy: "theme-first-v8",
  rankingRevision: `related-pets-theme-first-v8:depth=8:cal=${V8_CALIBRATION_REVISION}:text=${TEXT_REVISION}:text-query=${RELATED_PETS_V8_TEXT_QUERY_REVISION}:visual=${VISUAL_REVISION}:candidate`,
  textQueryRevision: RELATED_PETS_V8_TEXT_QUERY_REVISION,
  textMinSimilarity: 0,
  visualMinSimilarity: null,
  visualWeight: 0,
} as const satisfies RelatedPetsRuntimeProfile;

export const RELATED_PETS_V8_PROFILE = {
  ...RELATED_PETS_V8_CALIBRATION_PROFILE,
  rankingRevision: `related-pets-theme-first-v8:depth=8:cal=${V8_CALIBRATION_REVISION}:text-min=${PINNED_V8_PROFILE.textMinSimilarity}:visual-min=${PINNED_V8_PROFILE.visualMinSimilarity}:visual-weight=${PINNED_V8_PROFILE.visualWeight}:text=${TEXT_REVISION}:text-query=${RELATED_PETS_V8_TEXT_QUERY_REVISION}:visual=${VISUAL_REVISION}`,
  textMinSimilarity: PINNED_V8_PROFILE.textMinSimilarity,
  visualMinSimilarity: PINNED_V8_PROFILE.visualMinSimilarity,
  visualWeight: PINNED_V8_PROFILE.visualWeight,
} as const satisfies RelatedPetsRuntimeProfile;

export const CURRENT_RELATED_PETS_RANKING_PROFILE =
  RELATED_PETS_V11_PROFILE;

export function isCurrentRelatedPetsRankingRevision(
  value: string,
): boolean {
  return value === CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision;
}
