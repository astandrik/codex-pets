import type {
  RelatedPetAnnotationInput,
  RelatedPetAnnotationProposal,
} from "../../src/lib/pets/related-pets-annotation-contract.mjs";
import type {
  ResumableBackfillOptions,
  ResumableBackfillSummary,
} from "./resumable-backfill.mjs";

type StoredRelatedPetAnnotation = {
  slug: string;
  sourceHash: string;
  proposalJson?: string;
  annotationJson: string;
  annotationText: string;
};

export type RelatedPetAnnotationBackfillOptions = ResumableBackfillOptions & {
  reuseProposalsFrom: string | null;
};
export type RelatedPetAnnotationBackfillSummary = ResumableBackfillSummary;
export function parseRelatedPetAnnotationBackfillArgs(
  argv: readonly string[],
): RelatedPetAnnotationBackfillOptions;
export function createStoredRelatedPetAnnotationProposalLoader(input: {
  sourceRevision: string;
  getAnnotation: (
    revision: string,
    slug: string,
  ) => Promise<{ proposalJson?: string } | null>;
}): (pet: RelatedPetAnnotationInput) => Promise<RelatedPetAnnotationProposal>;
export function runRelatedPetAnnotationBackfill(input: {
  options: RelatedPetAnnotationBackfillOptions;
  annotationRevision: string;
  modelUri: string;
  pets: readonly RelatedPetAnnotationInput[];
  getAnnotation: (revision: string, slug: string) => Promise<unknown>;
  createProposal: (
    pet: RelatedPetAnnotationInput,
  ) => Promise<RelatedPetAnnotationProposal>;
  upsertAnnotation: (input: Record<string, unknown>) => Promise<void>;
  createSourceHash: (input: {
    pet: RelatedPetAnnotationInput;
    modelUri: string;
    annotationRevision?: string;
  }) => string;
  now?: () => Date;
  log?: (entry: unknown) => void;
}): Promise<RelatedPetAnnotationBackfillSummary>;
export function runRelatedPetAnnotationEmbeddingBackfill(input: {
  options: RelatedPetAnnotationBackfillOptions;
  annotationRevision: string;
  modelRevision: string;
  role: "query" | "document";
  dimensions: number;
  pets: readonly RelatedPetAnnotationInput[];
  annotations: readonly StoredRelatedPetAnnotation[];
  getMetadata: (
    modelRevision: string,
    slug: string,
  ) => Promise<{ sourceHash: string; dimensions: number } | null>;
  embed: (text: string, role: "query" | "document") => Promise<number[]>;
  upsert: (input: {
    modelRevision: string;
    slug: string;
    sourceHash: string;
    dimensions: number;
    embedding: number[];
    updatedAt: string;
  }) => Promise<void>;
  now?: () => Date;
  log?: (entry: unknown) => void;
}): Promise<RelatedPetAnnotationBackfillSummary>;
