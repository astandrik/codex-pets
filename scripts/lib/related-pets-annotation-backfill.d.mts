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
  proposalRevision?: string;
  proposalInputHash?: string;
  proposalHash?: string;
  proposalJson?: string;
  annotationJson: string;
  annotationText: string;
};

export type RelatedPetAnnotationBackfillOptions = ResumableBackfillOptions & {
  reuseProposalsFrom?: string | null;
  expectedCatalogFingerprint?: string | null;
};
export type RelatedPetAnnotationBackfillPet = RelatedPetAnnotationInput & {
  createdAt: string;
  approvedAt: string;
};
export type RelatedPetAnnotationBackfillSummary = ResumableBackfillSummary & {
  proposalReused: number;
  proposalGenerated: number;
};
export function parseRelatedPetAnnotationBackfillArgs(
  argv: readonly string[],
): RelatedPetAnnotationBackfillOptions;
export function adoptLegacyRelatedPetAnnotationProposal(
  stored: StoredRelatedPetAnnotation | null,
  proposalInputHash: string,
): StoredRelatedPetAnnotation | null;
export function createRelatedPetAnnotationCatalogFingerprint(
  pets: readonly RelatedPetAnnotationBackfillPet[],
): string;
export function assertRelatedPetAnnotationCatalogFingerprint(
  options: RelatedPetAnnotationBackfillOptions,
  pets: readonly RelatedPetAnnotationBackfillPet[],
): string | null;
export function runRelatedPetAnnotationBackfill(input: {
  options: RelatedPetAnnotationBackfillOptions;
  annotationRevision: string;
  modelUri: string;
  pets: readonly RelatedPetAnnotationBackfillPet[];
  getAnnotation: (
    revision: string,
    slug: string,
  ) => Promise<StoredRelatedPetAnnotation | null>;
  findReusableProposal?: (input: {
    slug: string;
    proposalRevision: string;
    proposalInputHash: string;
  }) => Promise<StoredRelatedPetAnnotation | null>;
  createProposal: (
    pet: RelatedPetAnnotationInput,
  ) => Promise<RelatedPetAnnotationProposal>;
  upsertAnnotation: (input: Record<string, unknown>) => Promise<void>;
  now?: () => Date;
  log?: (entry: unknown) => void;
}): Promise<RelatedPetAnnotationBackfillSummary>;
export function runRelatedPetAnnotationEmbeddingBackfill(input: {
  options: RelatedPetAnnotationBackfillOptions;
  annotationRevision: string;
  modelRevision: string;
  role: "query" | "document";
  dimensions: number;
  modelUri: string | null;
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
