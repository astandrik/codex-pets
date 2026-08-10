export type BackfillOptions = {
  mode: "dry-run" | "apply";
  slug: string | null;
  force: boolean;
};

export type BackfillPet = {
  slug: string;
  displayName: string;
  description: string;
  kind: string;
  tags: string[];
  status?: string;
};

export type BackfillSummary = {
  scanned: number;
  unchanged: number;
  planned: number;
  updated: number;
};

export function parseBackfillArgs(argv: string[]): BackfillOptions;
export function buildPetSearchDocument(pet: BackfillPet): string;
export function buildRelatedPetQuery(
  pet: BackfillPet,
  modelRevision: string,
): string;
export function buildRelatedPetDocument(
  pet: BackfillPet,
  modelRevision: string,
): string;
export function createPetSearchSourceHash(
  pet: BackfillPet,
  modelRevision: string,
): string;
export function createRelatedPetQuerySourceHash(
  pet: BackfillPet,
  modelRevision: string,
): string;
export function createRelatedPetDocumentSourceHash(
  pet: BackfillPet,
  modelRevision: string,
): string;
export function embeddingToBuffer(embedding: readonly number[]): Buffer;
export function createRequestStartLimiter(input: {
  requestsPerMinute: number;
  now?: () => number;
  sleep: (milliseconds: number) => Promise<void>;
}): () => Promise<void>;
export function runPetSearchBackfill(input: {
  options: BackfillOptions;
  revision: string;
  dimensions: number;
  pets: BackfillPet[];
  getMetadata: (
    modelRevision: string,
    slug: string,
  ) => Promise<{ sourceHash: string; dimensions: number } | null>;
  embedDocument: (document: string) => Promise<number[]>;
  upsert: (input: {
    modelRevision: string;
    slug: string;
    sourceHash: string;
    dimensions: number;
    embedding: readonly number[];
    updatedAt: string;
  }) => Promise<void>;
  buildInput?: (pet: BackfillPet) => string;
  createSourceHash?: (pet: BackfillPet, modelRevision: string) => string;
  now?: () => Date;
  log?: (entry: unknown) => void;
}): Promise<BackfillSummary>;
