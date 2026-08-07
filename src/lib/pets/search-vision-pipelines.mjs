export const PET_VISION_CAPTION_REVISION_V1 =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1";
export const PET_VISION_CAPTION_REVISION_V2 =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-08-v2";
export const PET_VISION_CAPTION_REVISION_V3 =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-08-v3";

export const PET_VISUAL_MODEL_REVISION_V1 =
  "yandex-text-search-2026-07-pet-vision-v1";
export const PET_VISUAL_MODEL_REVISION_V2 =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v2";
export const PET_VISUAL_MODEL_REVISION_V3 =
  "yandex-text-embeddings-v2-768-pet-vision-qwen3.6-v3";

export const PET_VISION_FRAME_POLICY_V1 = {
  id: "pet-vision-central-frames-v1",
  frames: [
    { state: "idle", row: 0, frameCount: 6, frame: 3 },
    { state: "running-right", row: 1, frameCount: 8, frame: 4 },
    { state: "waving", row: 3, frameCount: 4, frame: 2 },
    { state: "review", row: 8, frameCount: 6, frame: 3 },
  ],
};

export const PET_VISION_FRAME_POLICY_V2 = {
  id: "pet-vision-nine-central-frames-v2",
  frames: [
    { state: "idle", row: 0, frameCount: 6, frame: 3 },
    { state: "running-right", row: 1, frameCount: 8, frame: 4 },
    { state: "running-left", row: 2, frameCount: 8, frame: 4 },
    { state: "waving", row: 3, frameCount: 4, frame: 2 },
    { state: "jumping", row: 4, frameCount: 5, frame: 2 },
    { state: "failed", row: 5, frameCount: 8, frame: 4 },
    { state: "waiting", row: 6, frameCount: 6, frame: 3 },
    { state: "running", row: 7, frameCount: 6, frame: 3 },
    { state: "review", row: 8, frameCount: 6, frame: 3 },
  ],
};

export const PET_VISION_FRAME_POLICY_V3 = {
  id: "pet-vision-four-central-frames-v3",
  frames: PET_VISION_FRAME_POLICY_V1.frames,
};

const BILINGUAL_REQUIRED = {
  type: "object",
  additionalProperties: false,
  required: ["en", "ru"],
  properties: {
    en: { type: "string", minLength: 1, maxLength: 320 },
    ru: { type: "string", minLength: 1, maxLength: 320 },
  },
};

const BILINGUAL_OPTIONAL = {
  type: "object",
  additionalProperties: false,
  required: ["en", "ru"],
  properties: {
    en: { type: "string", maxLength: 240 },
    ru: { type: "string", maxLength: 240 },
  },
};

const SHARED_DEFINITIONS = {
  bilingualRequired: BILINGUAL_REQUIRED,
  bilingualOptional: BILINGUAL_OPTIONAL,
  termList: {
    type: "array",
    minItems: 1,
    maxItems: 8,
    items: { type: "string", minLength: 1, maxLength: 40 },
  },
  searchTermList: {
    type: "array",
    minItems: 3,
    maxItems: 20,
    items: { type: "string", minLength: 1, maxLength: 60 },
  },
};

const COLORS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["en", "ru"],
  properties: {
    en: { $ref: "#/$defs/termList" },
    ru: { $ref: "#/$defs/termList" },
  },
};

export const PET_VISION_RESPONSE_JSON_SCHEMA_V1 = {
  type: "object",
  additionalProperties: false,
  required: [
    "subject",
    "appearance",
    "clothing",
    "style",
    "mood",
    "colors",
    "search_terms_en",
    "search_terms_ru",
  ],
  properties: {
    subject: { $ref: "#/$defs/bilingualRequired" },
    appearance: { $ref: "#/$defs/bilingualRequired" },
    clothing: { $ref: "#/$defs/bilingualOptional" },
    style: { $ref: "#/$defs/bilingualRequired" },
    mood: { $ref: "#/$defs/bilingualRequired" },
    colors: COLORS_SCHEMA,
    search_terms_en: { $ref: "#/$defs/searchTermList" },
    search_terms_ru: { $ref: "#/$defs/searchTermList" },
  },
  $defs: SHARED_DEFINITIONS,
};

export const PET_VISION_RESPONSE_JSON_SCHEMA_V2 = {
  type: "object",
  additionalProperties: false,
  required: [
    "subject",
    "appearance",
    "clothing",
    "style",
    "mood",
    "colors",
    "accessories",
    "distinctive_features",
    "pose_motion",
    "search_terms_en",
    "search_terms_ru",
  ],
  properties: {
    subject: { $ref: "#/$defs/bilingualRequired" },
    appearance: { $ref: "#/$defs/bilingualRequired" },
    clothing: { $ref: "#/$defs/bilingualOptional" },
    style: { $ref: "#/$defs/bilingualRequired" },
    mood: { $ref: "#/$defs/bilingualRequired" },
    colors: COLORS_SCHEMA,
    accessories: { $ref: "#/$defs/bilingualOptional" },
    distinctive_features: { $ref: "#/$defs/bilingualOptional" },
    pose_motion: { $ref: "#/$defs/bilingualOptional" },
    search_terms_en: { $ref: "#/$defs/searchTermList" },
    search_terms_ru: { $ref: "#/$defs/searchTermList" },
  },
  $defs: SHARED_DEFINITIONS,
};

const V1_SYSTEM_PROMPT =
  "You create internal search metadata for an animated software companion from four sprite frames. Describe only visible evidence. Do not infer or use identity, a character name, existing catalog metadata, hidden backstory, protected attributes, or an exact age. Use neutral language when uncertain. Describe visible subject type, appearance, clothing or accessories, art style, mood or pose, dominant colors, and concrete search concepts. Apply the same descriptive standard to every visual style; do not apply catalog-category or audience filters. English and Russian fields must be semantic equivalents. Output only JSON matching the supplied schema.";
const V1_USER_PROMPT =
  "The four images are ordered as idle, running-right, waving, and review. Produce the bilingual visual-search caption.";

const V2_SYSTEM_PROMPT =
  "You create internal search metadata for an animated software companion from nine sprite frames. Describe only visible evidence across the complete sequence. Do not infer or use identity, a character name, existing catalog metadata, hidden backstory, protected attributes, or an exact age. Use neutral language when uncertain. Describe visible subject type, appearance, clothing, accessories, distinctive features, art style, mood, pose or motion, dominant colors, and concrete search concepts. Apply the same descriptive standard to every visual style; do not apply catalog-category or audience filters. Every bilingual field must contain semantic equivalents in English and Russian. Output only JSON matching the supplied schema.";
const V2_USER_PROMPT =
  "The nine images are ordered as idle, running-right, running-left, waving, jumping, failed, waiting, running, and review. Produce the bilingual visual-search caption from evidence visible in these frames.";

const V3_SYSTEM_PROMPT =
  "You create internal search metadata for an animated software companion from four sprite frames. Describe only visible evidence across the complete sequence. Do not infer or use identity, a character name, existing catalog metadata, hidden backstory, protected attributes, or an exact age. Use neutral language when uncertain. Describe visible subject type, appearance, clothing, accessories, distinctive features, art style, mood, pose or motion, dominant colors, and concrete search concepts. Apply the same descriptive standard to every visual style; do not apply catalog-category or audience filters. Every bilingual field must contain semantic equivalents in English and Russian. Output only JSON matching the supplied schema.";
const V3_USER_PROMPT =
  "The four images are ordered as idle, running-right, waving, and review. Produce the bilingual visual-search caption from evidence visible in these frames.";

export const PET_VISION_PIPELINES = {
  [PET_VISION_CAPTION_REVISION_V1]: {
    api: "responses",
    modelName: "qwen3.6-35b-a3b",
    schemaVersion: 1,
    responseSchemaName: "pet_visual_caption_v1",
    systemPrompt: V1_SYSTEM_PROMPT,
    userPrompt: V1_USER_PROMPT,
    responseJsonSchema: PET_VISION_RESPONSE_JSON_SCHEMA_V1,
    framePolicy: PET_VISION_FRAME_POLICY_V1,
    tokenPolicy: { initial: 8_000, retry: 16_000, maxAttempts: 3 },
  },
  [PET_VISION_CAPTION_REVISION_V2]: {
    api: "responses",
    modelName: "qwen3.6-35b-a3b",
    schemaVersion: 2,
    responseSchemaName: "pet_visual_caption_v2",
    systemPrompt: V2_SYSTEM_PROMPT,
    userPrompt: V2_USER_PROMPT,
    responseJsonSchema: PET_VISION_RESPONSE_JSON_SCHEMA_V2,
    framePolicy: PET_VISION_FRAME_POLICY_V2,
    tokenPolicy: { initial: 8_000, retry: 16_000, maxAttempts: 3 },
  },
  [PET_VISION_CAPTION_REVISION_V3]: {
    api: "responses",
    modelName: "qwen3.6-35b-a3b",
    schemaVersion: 2,
    responseSchemaName: "pet_visual_caption_v3",
    systemPrompt: V3_SYSTEM_PROMPT,
    userPrompt: V3_USER_PROMPT,
    responseJsonSchema: PET_VISION_RESPONSE_JSON_SCHEMA_V2,
    framePolicy: PET_VISION_FRAME_POLICY_V3,
    tokenPolicy: { initial: 8_000, retry: 16_000, maxAttempts: 3 },
  },
};

export function requirePetVisionPipeline(captionRevision) {
  const pipeline = PET_VISION_PIPELINES[captionRevision];
  if (!pipeline) {
    throw new Error(`Unsupported pet vision caption revision: ${captionRevision}`);
  }
  return pipeline;
}

export function findPetVisionSchemaVersionTwoPipeline(
  provenance,
  expectedCaptionRevision,
) {
  const entries = expectedCaptionRevision
    ? [[
        expectedCaptionRevision,
        PET_VISION_PIPELINES[expectedCaptionRevision],
      ]]
    : Object.entries(PET_VISION_PIPELINES);
  return entries.find(([, pipeline]) =>
    pipeline &&
    pipeline.schemaVersion === 2 &&
    provenance.origin === "provider" &&
    provenance.api === pipeline.api &&
    provenance.model === pipeline.modelName &&
    provenance.framePolicy === pipeline.framePolicy.id
  ) ?? null;
}
