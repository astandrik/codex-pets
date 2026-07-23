export type VisionBackfillOptions = {
  mode: "dry-run" | "apply";
  slug: string | null;
  force: boolean;
  canaries: boolean;
};

export type VisionBackfillBilingualText = { en: string; ru: string };

export type VisionBackfillCaptionV1 = {
  subject: VisionBackfillBilingualText;
  appearance: VisionBackfillBilingualText;
  clothing: VisionBackfillBilingualText;
  style: VisionBackfillBilingualText;
  mood: VisionBackfillBilingualText;
  colors: { en: string[]; ru: string[] };
  search_terms_en: string[];
  search_terms_ru: string[];
};

export type VisionBackfillCaptionV2 = VisionBackfillCaptionV1 & {
  accessories: VisionBackfillBilingualText;
};

export type VisionBackfillAttributeSlotV3 =
  | "hair_and_headwear"
  | "face_and_eye_coverings"
  | "clothing_and_armor"
  | "weapons_and_objects"
  | "visible_effects"
  | "other_distinguishing_features";

export type VisionBackfillCaptionV3 = {
  subject: { en: string; ru: string };
  appearance: { en: string; ru: string };
  style: { en: string; ru: string };
  mood: { en: string; ru: string };
  colors: { en: string[]; ru: string[] };
  search_terms_en: string[];
  search_terms_ru: string[];
  visual_attributes: Record<
    VisionBackfillAttributeSlotV3,
    { present: boolean; en: string; ru: string }
  >;
};

export type VisionBackfillCaption =
  | VisionBackfillCaptionV1
  | VisionBackfillCaptionV2
  | VisionBackfillCaptionV3;

export type VisionBackfillCaptionRevision =
  | "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1"
  | "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v2"
  | "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v3";

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
export const PET_VISION_CAPTION_REVISION_V1:
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1";
export const PET_VISION_CAPTION_REVISION_V2:
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v2";
export const PET_VISION_CAPTION_REVISION_V3:
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v3";
export const PET_VISUAL_MODEL_REVISION_V1:
  "yandex-text-search-2026-07-pet-vision-v1";
export const PET_VISUAL_MODEL_REVISION_V2:
  "yandex-text-search-2026-07-pet-vision-v2";
export const PET_VISUAL_MODEL_REVISION_V3:
  "yandex-text-search-2026-07-pet-vision-v3";
export const PET_VISION_SYSTEM_PROMPT: string;
export const PET_VISION_USER_PROMPT: string;
export const PET_VISION_RESPONSE_JSON_SCHEMA: Readonly<
  Record<string, unknown>
>;
export const PET_VISION_CAPTION_CONTRACTS: Record<
  VisionBackfillCaptionRevision,
  {
    modelName: string;
    schemaVersion: 1 | 2 | 3;
    responseSchemaName: string;
    maxTokens: number;
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
export const PET_VISION_V3_CANARIES: Array<{
  slug: string;
  expectations: Array<{
    id: string;
    slot:
      | "hair_and_headwear"
      | "face_and_eye_coverings"
      | "clothing_and_armor"
      | "weapons_and_objects"
      | "visible_effects"
      | "other_distinguishing_features";
    expectedAnyTermsEn: string[];
    expectedAnyTermsRu: string[];
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
): VisionBackfillCaptionV1;
export function parsePetVisionCaption(
  revision: typeof PET_VISION_CAPTION_REVISION_V1,
  input: unknown,
): VisionBackfillCaptionV1;
export function parsePetVisionCaption(
  revision: typeof PET_VISION_CAPTION_REVISION_V2,
  input: unknown,
): VisionBackfillCaptionV2;
export function parsePetVisionCaption(
  revision: typeof PET_VISION_CAPTION_REVISION_V3,
  input: unknown,
): VisionBackfillCaptionV3;
export function parsePetVisionCaption(
  revision: VisionBackfillCaptionRevision,
  input: unknown,
): VisionBackfillCaption;

export type VisionBackfillCaptionEnvelopeV1 = {
  schemaVersion: 1;
  source: { assetId: string; spritesheetSha256: string };
  caption: VisionBackfillCaptionV1;
};
export type VisionBackfillCaptionEnvelopeV2 = {
  schemaVersion: 2;
  source: { assetId: string; spritesheetSha256: string };
  caption: VisionBackfillCaptionV2;
};
export type VisionBackfillCaptionEnvelopeV3 = {
  schemaVersion: 3;
  source: { assetId: string; spritesheetSha256: string };
  caption: VisionBackfillCaptionV3;
};
export type VisionBackfillCaptionEnvelope =
  | VisionBackfillCaptionEnvelopeV1
  | VisionBackfillCaptionEnvelopeV2
  | VisionBackfillCaptionEnvelopeV3;

export function createPetVisionCaptionEnvelope(input: {
  captionRevision?: typeof PET_VISION_CAPTION_REVISION_V1;
  assetId: string;
  spritesheetSha256: string;
  caption: VisionBackfillCaptionV1;
}): VisionBackfillCaptionEnvelopeV1;
export function createPetVisionCaptionEnvelope(input: {
  captionRevision: typeof PET_VISION_CAPTION_REVISION_V2;
  assetId: string;
  spritesheetSha256: string;
  caption: VisionBackfillCaptionV2;
}): VisionBackfillCaptionEnvelopeV2;
export function createPetVisionCaptionEnvelope(input: {
  captionRevision: typeof PET_VISION_CAPTION_REVISION_V3;
  assetId: string;
  spritesheetSha256: string;
  caption: VisionBackfillCaptionV3;
}): VisionBackfillCaptionEnvelopeV3;
export function createPetVisionCaptionEnvelope(input: {
  captionRevision: VisionBackfillCaptionRevision;
  assetId: string;
  spritesheetSha256: string;
  caption: VisionBackfillCaption;
}): VisionBackfillCaptionEnvelope;
export function parsePetVisionCaptionEnvelope(
  value: string,
): VisionBackfillCaptionEnvelopeV1;
export function parsePetVisionCaptionEnvelope(
  revision: typeof PET_VISION_CAPTION_REVISION_V1,
  value: string,
): VisionBackfillCaptionEnvelopeV1;
export function parsePetVisionCaptionEnvelope(
  revision: typeof PET_VISION_CAPTION_REVISION_V2,
  value: string,
): VisionBackfillCaptionEnvelopeV2;
export function parsePetVisionCaptionEnvelope(
  revision: typeof PET_VISION_CAPTION_REVISION_V3,
  value: string,
): VisionBackfillCaptionEnvelopeV3;
export function parsePetVisionCaptionEnvelope(
  revision: VisionBackfillCaptionRevision,
  value: string,
): VisionBackfillCaptionEnvelope;
export function buildPetVisionCaptionText(
  caption: VisionBackfillCaptionV1,
): string;
export function buildPetVisionCaptionText(
  revision: typeof PET_VISION_CAPTION_REVISION_V1,
  caption: VisionBackfillCaptionV1,
): string;
export function buildPetVisionCaptionText(
  revision: typeof PET_VISION_CAPTION_REVISION_V2,
  caption: VisionBackfillCaptionV2,
): string;
export function buildPetVisionCaptionText(
  revision: typeof PET_VISION_CAPTION_REVISION_V3,
  caption: VisionBackfillCaptionV3,
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
export function evaluatePetVisionV3Canary(
  slug: string,
  caption: VisionBackfillCaptionV3,
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
