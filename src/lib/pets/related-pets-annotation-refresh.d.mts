import type {
  RelatedPetAnnotationInput,
  RelatedPetAnnotationProposal,
  ResolvedRelatedPetAnnotation,
} from "./related-pets-annotation-contract.mjs";

export type StoredRelatedPetAnnotationRecord = {
  slug: string;
  sourceHash: string;
  proposalRevision?: string;
  proposalInputHash?: string;
  proposalHash?: string;
  proposalJson?: string;
  annotationJson: string;
  annotationText: string;
  updatedAt?: string;
};

type RefreshInput = {
  force?: boolean;
  pet: RelatedPetAnnotationInput;
  annotationRevision: string;
  proposalRevision?: string;
  modelUri: string;
  getAnnotation: (
    revision: string,
    slug: string,
  ) => Promise<StoredRelatedPetAnnotationRecord | null>;
  findReusableProposal?: (input: {
    slug: string;
    proposalRevision: string;
    proposalInputHash: string;
  }) => Promise<StoredRelatedPetAnnotationRecord | null>;
  createProposal: (
    pet: RelatedPetAnnotationInput,
  ) => Promise<RelatedPetAnnotationProposal>;
  upsertAnnotation: (input: {
    annotationRevision: string;
    slug: string;
    sourceHash: string;
    proposalRevision: string;
    proposalInputHash: string;
    proposalHash: string;
    proposalJson: string;
    annotationJson: string;
    annotationText: string;
    updatedAt: string;
  }) => Promise<void>;
  now?: () => Date;
};

export function refreshRelatedPetAnnotationRecord(
  input: RefreshInput & { mode: "apply" },
): Promise<{
  outcome: "unchanged" | "updated";
  proposalAction: "unchanged" | "reused" | "generated";
  sourceHash: string;
  annotationText: string;
}>;
export function refreshRelatedPetAnnotationRecord(
  input: RefreshInput & { mode: "dry-run" },
): Promise<{
  outcome: "unchanged" | "planned";
  proposalAction: "unchanged" | "reused" | "generated";
  sourceHash: string | null;
  annotationText: string | null;
}>;

export function validateCurrentRelatedPetAnnotation(input: {
  pet: RelatedPetAnnotationInput;
  stored: StoredRelatedPetAnnotationRecord;
  annotationRevision: string;
  proposalRevision?: string;
  modelUri: string;
}): {
  sourceHash: string;
  proposalRevision: string;
  proposalInputHash: string;
  proposalHash: string;
  annotation: ResolvedRelatedPetAnnotation;
  annotationText: string;
};
