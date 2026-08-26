import {
  PET_SEARCH_EMBEDDING_MODELS,
  PET_SEARCH_MODEL_REVISIONS,
  PET_VISUAL_MODEL_REVISIONS,
} from "@/lib/pets/search-config";
import {
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION,
  RELATED_PETS_DESCRIPTION_QUERY_REVISION,
} from "@/lib/pets/related-pets-semantics.mjs";
import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import { RELATED_PETS_V24_FALLBACK_POLICY_REVISION } from "@/lib/pets/related-pets-fallback-policy";
import { RELATED_PETS_V24_RELATION_POLICY_REVISION } from "@/lib/pets/related-pets-relation-policy";
import type { RelatedPetsV24RankingProfile } from "@/lib/pets/related-pets-ranking";

const EMBEDDING_REVISION = "yandex-text-embeddings-v2-768-2026-07";
const VISUAL_REVISION =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1";
const embeddingDefinition = PET_SEARCH_MODEL_REVISIONS[EMBEDDING_REVISION];
const visualDefinition = PET_VISUAL_MODEL_REVISIONS[VISUAL_REVISION];

export const RELATED_PETS_V24_DESCRIPTION_QUERY_REVISION =
  RELATED_PETS_DESCRIPTION_QUERY_REVISION;
export const RELATED_PETS_V24_DESCRIPTION_DOCUMENT_REVISION =
  RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION;

// This value is persisted with the active generation.
export const RELATED_PETS_V24_RANKING_REVISION =
  "related-pets-sparse-fallback-v24:depth=8:base=related-pets-franchise-coverage-v23:depth=8:base=related-pets-entity-controlled-v11-r3:depth=8:tail=description-first:gate=qualified-negatives:cal=related-pets-eval-v7:text-min=0.6167421023517932:annotation-min=0.4133420129086638:annotation-weight=1:visual-min=0.8178749331551675:visual-weight=0.25:description=yandex-text-embeddings-v2-768-related-description-document-2026-08-v1:description-query=yandex-text-embeddings-v2-768-related-description-query-2026-08-v3:annotation=yandex-qwen3.6-35b-a3b-related-annotation-2026-08-v11-r9:annotation-document=yandex-text-embeddings-v2-768-related-annotation-document-2026-08-v11-r9:annotation-query=yandex-text-embeddings-v2-768-related-annotation-query-2026-08-v11-r9:visual=yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v1:relation-policy=related-pets-relation-policy-2026-08-v23-r1:fallback-policy=related-pets-zero-qualified-empty-top4-shared-topic-visual-v24-r2";

type RelatedPetsV24RuntimeProfile = RelatedPetsV24RankingProfile & {
  rankingRevision: string;
  embeddingRevision: string;
  textRevision: string;
  textQueryRevision: string;
  textDimensions: number;
  annotationRevision: string;
  annotationDocumentRevision: string;
  annotationQueryRevision: string;
  annotationDimensions: number;
  visualRevision: string;
  visualDimensions: number;
};

export const RELATED_PETS_V24_PROFILE = {
  strategy: "sparse-fallback-v24",
  rankingRevision: RELATED_PETS_V24_RANKING_REVISION,
  embeddingRevision: EMBEDDING_REVISION,
  textRevision: RELATED_PETS_V24_DESCRIPTION_DOCUMENT_REVISION,
  textQueryRevision: RELATED_PETS_V24_DESCRIPTION_QUERY_REVISION,
  textDimensions:
    PET_SEARCH_EMBEDDING_MODELS[embeddingDefinition.embeddingModelId].dimensions,
  textMinSimilarity: 0.6167421023517932,
  annotationRevision: RELATED_PETS_ANNOTATION_REVISION,
  annotationDocumentRevision: RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  annotationQueryRevision: RELATED_PETS_ANNOTATION_QUERY_REVISION,
  annotationDimensions:
    PET_SEARCH_EMBEDDING_MODELS[embeddingDefinition.embeddingModelId].dimensions,
  annotationMinSimilarity: 0.4133420129086638,
  annotationWeight: 1,
  visualRevision: VISUAL_REVISION,
  visualDimensions:
    PET_SEARCH_EMBEDDING_MODELS[visualDefinition.embeddingModelId].dimensions,
  visualMinSimilarity: 0.8178749331551675,
  visualWeight: 0.25,
  relationPolicyRevision: RELATED_PETS_V24_RELATION_POLICY_REVISION,
  fallbackPolicyRevision: RELATED_PETS_V24_FALLBACK_POLICY_REVISION,
} as const satisfies RelatedPetsV24RuntimeProfile;
