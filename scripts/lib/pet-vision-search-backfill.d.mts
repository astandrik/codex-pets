export type VisionBackfillOptions = {
  mode: "dry-run" | "apply";
  slug: string | null;
  force: boolean;
};

export type VisionBackfillCaption = {
  subject: { en: string; ru: string };
  appearance: { en: string; ru: string };
  clothing: { en: string; ru: string };
  style: { en: string; ru: string };
  mood: { en: string; ru: string };
  colors: { en: string[]; ru: string[] };
  search_terms_en: string[];
  search_terms_ru: string[];
  accessories?: { en: string; ru: string };
};

export type VisionBackfillCaptionRevision =
  | "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1"
  | "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v2";

export type VisionBackfillFrame = {
  state: string;
  row: number;
  frame: number;
  png: Buffer;
  dataUrl: string;
};

export type StoredVisionBackfillCaption = {
  slug: string;
  sourceHash: string;
  captionJson: string;
  captionText: string;
  updatedAt: string;
};

export const PET_VISION_FRAME_POLICY: {
  id: string;
  frames: Array<{
    state: string;
    row: number;
    frameCount: number;
    frame: number;
  }>;
};
export const PET_VISION_CAPTION_REVISION_V1: VisionBackfillCaptionRevision;
export const PET_VISION_CAPTION_REVISION_V2: VisionBackfillCaptionRevision;
export const PET_VISUAL_MODEL_REVISION_V1: string;
export const PET_VISUAL_MODEL_REVISION_V2: string;
export const PET_VISION_SYSTEM_PROMPT: string;
export const PET_VISION_USER_PROMPT: string;
export const PET_VISION_RESPONSE_JSON_SCHEMA: Readonly<
  Record<string, unknown>
>;
export const PET_VISION_CAPTION_CONTRACTS: Record<
  VisionBackfillCaptionRevision,
  {
    modelName: string;
    schemaVersion: 1 | 2;
    responseSchemaName: string;
    systemPrompt: string;
    userPrompt: string;
    responseJsonSchema: Readonly<Record<string, unknown>>;
  }
>;
export const PET_VISUAL_MODEL_REVISIONS: Record<
  string,
  { captionRevision: VisionBackfillCaptionRevision; dimensions: number }
>;
export const PET_VISION_V2_CANARIES: Array<{
  slug: string;
  expectations: Array<{
    id: string;
    expectedAnyTerms: string[];
  }>;
}>;

export class PetVisionBackfillError extends Error {
  reason: string;
  canary: {
    slug: string;
    passed: boolean;
    checks: Array<{ id: string; passed: boolean }>;
  } | null;
}

export function parseVisionBackfillArgs(
  argv: string[],
): VisionBackfillOptions;
export function extractPetVisionFrames(
  spritesheet: Buffer,
): Promise<{
  spriteVersion: number;
  spritesheetSha256: string;
  frames: VisionBackfillFrame[];
}>;
export function parsePetVisionCaption(
  input: unknown,
): VisionBackfillCaption;
export function parsePetVisionCaption(
  revision: VisionBackfillCaptionRevision,
  input: unknown,
): VisionBackfillCaption;
export function createPetVisionCaptionEnvelope(input: {
  captionRevision?: VisionBackfillCaptionRevision;
  assetId: string;
  spritesheetSha256: string;
  caption: VisionBackfillCaption;
}): {
  schemaVersion: 1 | 2;
  source: { assetId: string; spritesheetSha256: string };
  caption: VisionBackfillCaption;
};
export function parsePetVisionCaptionEnvelope(value: string): {
  schemaVersion: 1 | 2;
  source: { assetId: string; spritesheetSha256: string };
  caption: VisionBackfillCaption;
};
export function parsePetVisionCaptionEnvelope(
  revision: VisionBackfillCaptionRevision,
  value: string,
): {
  schemaVersion: 1 | 2;
  source: { assetId: string; spritesheetSha256: string };
  caption: VisionBackfillCaption;
};
export function buildPetVisionCaptionText(
  caption: VisionBackfillCaption,
): string;
export function buildPetVisionCaptionText(
  revision: VisionBackfillCaptionRevision,
  caption: VisionBackfillCaption,
): string;
export function resolvePetVisionRevisionConfig(
  captionRevision: string,
  visualRevision: string,
): {
  captionRevision: VisionBackfillCaptionRevision;
  visualRevision: string;
  dimensions: number;
  captionContract: (typeof PET_VISION_CAPTION_CONTRACTS)[VisionBackfillCaptionRevision];
};
export function evaluatePetVisionCanary(
  slug: string,
  captionText: string,
): {
  slug: string;
  passed: boolean;
  checks: Array<{ id: string; passed: boolean }>;
} | null;
export function createPetVisionCaptionSourceHash(input: {
  captionRevision: string;
  modelUri: string;
  assetId: string;
  spritesheetSha256: string;
}): string;
export function createPetVisualEmbeddingSourceHash(input: {
  visualRevision: string;
  captionRevision: string;
  captionSourceHash: string;
  captionText: string;
}): string;
export function embeddingToBuffer(embedding: readonly number[]): Buffer;
export function runPetVisionSearchBackfill(input: {
  options: VisionBackfillOptions;
  config: {
    captionRevision: string;
    visualRevision: string;
    dimensions: number;
    modelUri: string;
  };
  pets: Array<{
    slug: string;
    status?: string;
    spritesheetUrl: string;
  }>;
  readSpritesheet: (assetId: string) => Promise<Buffer>;
  extractFrames: typeof extractPetVisionFrames;
  getCaption: (
    captionRevision: string,
    slug: string,
  ) => Promise<StoredVisionBackfillCaption | null>;
  getEmbeddingMetadata: (
    visualRevision: string,
    slug: string,
  ) => Promise<{ sourceHash: string; dimensions: number } | null>;
  createCaption: (
    frames: readonly VisionBackfillFrame[],
  ) => Promise<VisionBackfillCaption>;
  embedDocument: (text: string) => Promise<number[]>;
  upsertCaption: (input: {
    captionRevision: string;
    slug: string;
    sourceHash: string;
    captionJson: string;
    captionText: string;
    updatedAt: string;
  }) => Promise<void>;
  upsertEmbedding: (input: {
    modelRevision: string;
    slug: string;
    sourceHash: string;
    dimensions: number;
    embedding: readonly number[];
    updatedAt: string;
  }) => Promise<void>;
  now: () => Date;
  log: (entry: unknown) => void;
}): Promise<{
  scanned: number;
  unchanged: number;
  vectorOnly: number;
  captionAndVector: number;
}>;
