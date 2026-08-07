export type PetVisionFrameSelection = {
  state: string;
  row: number;
  frameCount: number;
  frame: number;
};

export type PetVisionPipeline = {
  api: "chat_completions" | "responses";
  modelName: string;
  schemaVersion: 1 | 2;
  responseSchemaName: string;
  systemPrompt: string;
  userPrompt: string;
  responseJsonSchema: Readonly<Record<string, unknown>>;
  framePolicy: {
    id: string;
    frames: readonly PetVisionFrameSelection[];
  };
  tokenPolicy: {
    initial: number;
    retry: number | null;
    maxAttempts: number;
  };
};

export const PET_VISION_CAPTION_REVISION_V1: "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1";
export const PET_VISION_CAPTION_REVISION_V2: "yandex-qwen3.6-35b-a3b-pet-caption-2026-08-v2";
export const PET_VISION_CAPTION_REVISION_V3: "yandex-qwen3.6-35b-a3b-pet-caption-2026-08-v3";
export const PET_VISUAL_MODEL_REVISION_V1: "yandex-text-search-2026-07-pet-vision-v1";
export const PET_VISUAL_MODEL_REVISION_V2: "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v2";
export const PET_VISUAL_MODEL_REVISION_V3: "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v3";
export const PET_VISION_FRAME_POLICY_V1: PetVisionPipeline["framePolicy"];
export const PET_VISION_FRAME_POLICY_V2: PetVisionPipeline["framePolicy"];
export const PET_VISION_FRAME_POLICY_V3: PetVisionPipeline["framePolicy"];
export const PET_VISION_RESPONSE_JSON_SCHEMA_V1: Readonly<Record<string, unknown>>;
export const PET_VISION_RESPONSE_JSON_SCHEMA_V2: Readonly<Record<string, unknown>>;
export const PET_VISION_PIPELINES: Record<string, PetVisionPipeline>;
export function requirePetVisionPipeline(captionRevision: string): PetVisionPipeline;
export function findPetVisionSchemaVersionTwoPipeline(
  provenance: {
    origin?: unknown;
    api?: unknown;
    model?: unknown;
    framePolicy?: unknown;
  },
  expectedCaptionRevision?: string,
): [string, PetVisionPipeline] | null;
