import type {
  RelatedPetAnnotationInput,
  RelatedPetAnnotationProposal,
} from "./related-pets-annotation-contract.mjs";

export type StoredRelatedPetAnnotationRecord = {
  slug: string;
  sourceHash: string;
  proposalJson?: string;
  annotationJson: string;
  annotationText: string;
  updatedAt?: string;
};

type AnnotationSourceHash = (input: {
  pet: RelatedPetAnnotationInput;
  modelUri: string;
  annotationRevision?: string;
}) => string;

type RefreshInput = {
  force?: boolean;
  pet: RelatedPetAnnotationInput;
  annotationRevision: string;
  modelUri: string;
  getAnnotation: (
    revision: string,
    slug: string,
  ) => Promise<StoredRelatedPetAnnotationRecord | null>;
  createProposal: (
    pet: RelatedPetAnnotationInput,
  ) => Promise<RelatedPetAnnotationProposal>;
  upsertAnnotation: (input: {
    annotationRevision: string;
    slug: string;
    sourceHash: string;
    proposalJson: string;
    annotationJson: string;
    annotationText: string;
    updatedAt: string;
  }) => Promise<void>;
  createSourceHash?: AnnotationSourceHash;
  now?: () => Date;
};

export function refreshRelatedPetAnnotationRecord(
  input: RefreshInput & { mode: "apply" },
): Promise<{
  outcome: "unchanged" | "updated";
  sourceHash: string;
  annotationText: string;
}>;
export function refreshRelatedPetAnnotationRecord(
  input: RefreshInput & { mode: "dry-run" },
): Promise<{
  outcome: "unchanged" | "planned";
  sourceHash: string;
  annotationText: string | null;
}>;

export function validateCurrentRelatedPetAnnotation(input: {
  pet: RelatedPetAnnotationInput;
  stored: StoredRelatedPetAnnotationRecord;
  annotationRevision: string;
  modelUri: string;
  createSourceHash?: AnnotationSourceHash;
  expectedSourceHash?: string;
}): { sourceHash: string; annotationText: string };
