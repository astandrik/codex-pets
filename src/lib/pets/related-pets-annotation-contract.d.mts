import type { PetKind } from "./types";
import type { RelatedPetAnnotationOverride } from "./related-pets-annotation-control.mjs";

export type RelatedPetAnnotationEvidence =
  | "name"
  | "description"
  | "tag"
  | "world_knowledge";
export type RelatedPetAnnotationConfidence = "high" | "medium" | "none";
export type RelatedPetRelationProposal = {
  key: string;
  confidence: RelatedPetAnnotationConfidence;
  evidence: RelatedPetAnnotationEvidence[];
};
export type RelatedPetEntityProposal = Omit<
  RelatedPetRelationProposal,
  "key"
> & {
  key: string | null;
  aliases: string[];
};
export type RelatedPetAnnotationProposal = {
  entity: RelatedPetEntityProposal;
  franchises: RelatedPetRelationProposal[];
  franchiseFamilies: RelatedPetRelationProposal[];
  collections: RelatedPetRelationProposal[];
  specificArchetypes: RelatedPetRelationProposal[];
  themes: RelatedPetRelationProposal[];
  mediaOrigins: RelatedPetRelationProposal[];
};
export type ResolvedRelatedPetAnnotation = {
  schemaVersion: 1;
  entity: string | null;
  aliases: string[];
  franchises: string[];
  franchiseFamilies: string[];
  collections: string[];
  specificArchetypes: string[];
  themes: string[];
  mediaOrigins: string[];
};
export type RelatedPetAnnotationInput = {
  slug: string;
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
};

export const RELATED_PETS_ANNOTATION_REVISION: string;
export const RELATED_PETS_ANNOTATION_QUERY_REVISION: string;
export const RELATED_PETS_ANNOTATION_DOCUMENT_REVISION: string;
export const RELATED_PETS_ANNOTATION_PROPOSAL_REVISION: string;
export const RELATED_PETS_ANNOTATION_MODEL_NAME: string;
export const RELATED_PETS_ANNOTATION_SCHEMA_NAME: string;
export const RELATED_PETS_ANNOTATION_TOKEN_POLICY: Readonly<{
  revision: string;
  api: string;
  reasoning: string;
  initialMaxOutputTokens: number;
  retryMaxOutputTokens: number;
}>;
export const RELATED_PETS_ANNOTATION_SYSTEM_PROMPT: string;
export const RELATED_PETS_ANNOTATION_USER_PROMPT: string;
export const RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA: object;

export function parseRelatedPetAnnotationProposal(
  input: unknown,
): RelatedPetAnnotationProposal;
export function parseStoredRelatedPetAnnotationProposal(
  input: unknown,
): RelatedPetAnnotationProposal;
export function resolveRelatedPetAnnotation(input: {
  slug: string;
  proposal: unknown;
  overrides?: Readonly<Record<string, RelatedPetAnnotationOverride>>;
}): ResolvedRelatedPetAnnotation;
export function listUnresolvedStrongRelations(input: {
  slug: string;
  proposal: unknown;
  overrides?: Readonly<Record<string, RelatedPetAnnotationOverride>>;
}): string[];
export function buildRelatedPetAnnotationInput(
  pet: RelatedPetAnnotationInput,
): string;
export function buildRelatedPetAnnotationText(
  annotation: ResolvedRelatedPetAnnotation,
): string;
export function createRelatedPetAnnotationProposalInputHash(input: {
  pet: RelatedPetAnnotationInput;
  modelUri: string;
  proposalRevision?: string;
  tokenPolicy?: typeof RELATED_PETS_ANNOTATION_TOKEN_POLICY;
}): string;
export function createRelatedPetAnnotationProposalHash(
  proposal: unknown,
): string;
export function createRelatedPetAnnotationSourceHash(input: {
  slug: string;
  annotationRevision?: string;
  proposalRevision?: string;
  proposalInputHash: string;
  proposalHash: string;
  overrides?: Readonly<Record<string, RelatedPetAnnotationOverride>>;
}): string;
export function createRelatedPetAnnotationEmbeddingSourceHash(input: {
  modelRevision: string;
  role: "query" | "document";
  annotationRevision?: string;
  annotationSourceHash: string;
  annotationText: string;
}): string;
export function parseResolvedRelatedPetAnnotation(
  input: unknown,
): ResolvedRelatedPetAnnotation;
