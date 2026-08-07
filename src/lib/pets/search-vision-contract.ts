import { createHash } from "node:crypto";

import {
  PET_VISION_CAPTION_REVISION_V1,
  PET_VISION_CAPTION_REVISION_V2 as PIPELINE_CAPTION_REVISION_V2,
  PET_VISUAL_MODEL_REVISION_V1,
  PET_VISUAL_MODEL_REVISION_V2 as PIPELINE_VISUAL_REVISION_V2,
  PET_VISION_PIPELINES,
  requirePetVisionPipeline,
} from "@/lib/pets/search-vision-pipelines.mjs";

export const PET_VISION_CAPTION_REVISION = PET_VISION_CAPTION_REVISION_V1;
export const PET_VISION_CAPTION_REVISION_V2 =
  PIPELINE_CAPTION_REVISION_V2;
export const PET_VISUAL_MODEL_REVISION = PET_VISUAL_MODEL_REVISION_V1;
export const PET_VISUAL_MODEL_REVISION_V2 = PIPELINE_VISUAL_REVISION_V2;

const V1_PIPELINE = PET_VISION_PIPELINES[PET_VISION_CAPTION_REVISION];
const V2_PIPELINE = PET_VISION_PIPELINES[PET_VISION_CAPTION_REVISION_V2];

export const PET_VISION_SYSTEM_PROMPT = V1_PIPELINE.systemPrompt;
export const PET_VISION_USER_PROMPT = V1_PIPELINE.userPrompt;
export const PET_VISION_RESPONSE_JSON_SCHEMA =
  V1_PIPELINE.responseJsonSchema;
export const PET_VISION_SYSTEM_PROMPT_V2 = V2_PIPELINE.systemPrompt;
export const PET_VISION_USER_PROMPT_V2 = V2_PIPELINE.userPrompt;
export const PET_VISION_RESPONSE_JSON_SCHEMA_V2 =
  V2_PIPELINE.responseJsonSchema;

export type BilingualText = {
  en: string;
  ru: string;
};

export type PetVisionCaptionV1 = {
  subject: BilingualText;
  appearance: BilingualText;
  clothing: BilingualText;
  style: BilingualText;
  mood: BilingualText;
  colors: { en: string[]; ru: string[] };
  search_terms_en: string[];
  search_terms_ru: string[];
};

export type PetVisionCaptionV2 = PetVisionCaptionV1 & {
  accessories: BilingualText;
  distinctive_features: BilingualText;
  pose_motion: BilingualText;
};

export type PetVisionCaption = PetVisionCaptionV1 | PetVisionCaptionV2;

export type PetVisionCaptionEnvelopeV1 = {
  schemaVersion: 1;
  source: {
    assetId: string;
    spritesheetSha256: string;
  };
  caption: PetVisionCaptionV1;
};

export type PetVisionCaptionEnvelopeV2 = {
  schemaVersion: 2;
  source: {
    assetId: string;
    spritesheetSha256: string;
  };
  provenance: {
    origin: "provider";
    api: "responses";
    model: "qwen3.6-35b-a3b";
    framePolicy: "pet-vision-nine-central-frames-v2";
  };
  caption: PetVisionCaptionV2;
};

export type PetVisionCaptionEnvelope =
  | PetVisionCaptionEnvelopeV1
  | PetVisionCaptionEnvelopeV2;

const CAPTION_FIELDS = [
  "subject",
  "appearance",
  "clothing",
  "style",
  "mood",
  "colors",
  "search_terms_en",
  "search_terms_ru",
] as const;

const CAPTION_FIELDS_V2 = [
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
] as const;

export function parsePetVisionCaption(input: unknown): PetVisionCaptionV1 {
  return parseCaptionValue(input, false) as PetVisionCaptionV1;
}

export function parsePetVisionCaptionForRevision(
  input: unknown,
  captionRevision: string,
): PetVisionCaption {
  const pipeline = requirePetVisionPipeline(captionRevision);
  return parseCaptionValue(input, pipeline.schemaVersion === 2);
}

function parseCaptionValue(
  input: unknown,
  includeV2Fields: boolean,
): PetVisionCaption {
  const value = strictObject(
    input,
    "caption",
    includeV2Fields ? CAPTION_FIELDS_V2 : CAPTION_FIELDS,
  );
  const shared: PetVisionCaptionV1 = {
    subject: bilingualText(value.subject, "subject", 320, true),
    appearance: bilingualText(value.appearance, "appearance", 320, true),
    clothing: bilingualText(value.clothing, "clothing", 240, false),
    style: bilingualText(value.style, "style", 320, true),
    mood: bilingualText(value.mood, "mood", 320, true),
    colors: {
      en: stringList(
        strictObject(value.colors, "colors", ["en", "ru"]).en,
        "colors.en",
        1,
        8,
        40,
      ),
      ru: stringList(
        strictObject(value.colors, "colors", ["en", "ru"]).ru,
        "colors.ru",
        1,
        8,
        40,
      ),
    },
    search_terms_en: stringList(
      value.search_terms_en,
      "search_terms_en",
      3,
      20,
      60,
    ),
    search_terms_ru: stringList(
      value.search_terms_ru,
      "search_terms_ru",
      3,
      20,
      60,
    ),
  };
  if (!includeV2Fields) return shared;
  return {
    ...shared,
    accessories: bilingualText(
      value.accessories,
      "accessories",
      240,
      false,
    ),
    distinctive_features: bilingualText(
      value.distinctive_features,
      "distinctive_features",
      240,
      false,
    ),
    pose_motion: bilingualText(
      value.pose_motion,
      "pose_motion",
      240,
      false,
    ),
  };
}

export function createPetVisionCaptionEnvelope(input: {
  assetId: string;
  spritesheetSha256: string;
  caption: PetVisionCaption;
  captionRevision?: string;
}): PetVisionCaptionEnvelope {
  const captionRevision =
    input.captionRevision ?? PET_VISION_CAPTION_REVISION;
  const pipeline = requirePetVisionPipeline(captionRevision);
  if (pipeline.schemaVersion === 2) {
    return parseEnvelopeValue({
      schemaVersion: 2,
      source: {
        assetId: input.assetId,
        spritesheetSha256: input.spritesheetSha256,
      },
      provenance: {
        origin: "provider",
        api: "responses",
        model: pipeline.modelName,
        framePolicy: pipeline.framePolicy.id,
      },
      caption: input.caption,
    });
  }
  return parseEnvelopeValue({
    schemaVersion: 1,
    source: {
      assetId: input.assetId,
      spritesheetSha256: input.spritesheetSha256,
    },
    caption: input.caption,
  });
}

export function parsePetVisionCaptionEnvelope(
  value: string,
  expectedCaptionRevision?: string,
): PetVisionCaptionEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Caption envelope must contain one JSON object.");
  }
  const envelope = parseEnvelopeValue(parsed);
  if (expectedCaptionRevision) {
    const expectedPipeline =
      PET_VISION_PIPELINES[expectedCaptionRevision];
    if (
      expectedPipeline &&
      envelope.schemaVersion !== expectedPipeline.schemaVersion
    ) {
      throw new Error("Caption envelope revision does not match its schema.");
    }
  }
  return envelope;
}

export function buildPetVisionCaptionText(
  caption: PetVisionCaption,
): string {
  const lines = [
    `subject_en: ${caption.subject.en}`,
    `subject_ru: ${caption.subject.ru}`,
    `appearance_en: ${caption.appearance.en}`,
    `appearance_ru: ${caption.appearance.ru}`,
    `clothing_en: ${caption.clothing.en}`,
    `clothing_ru: ${caption.clothing.ru}`,
    `style_en: ${caption.style.en}`,
    `style_ru: ${caption.style.ru}`,
    `mood_en: ${caption.mood.en}`,
    `mood_ru: ${caption.mood.ru}`,
    `colors_en: ${caption.colors.en.join(", ")}`,
    `colors_ru: ${caption.colors.ru.join(", ")}`,
  ];
  if ("accessories" in caption) {
    lines.push(
      `accessories_en: ${caption.accessories.en}`,
      `accessories_ru: ${caption.accessories.ru}`,
      `distinctive_features_en: ${caption.distinctive_features.en}`,
      `distinctive_features_ru: ${caption.distinctive_features.ru}`,
      `pose_motion_en: ${caption.pose_motion.en}`,
      `pose_motion_ru: ${caption.pose_motion.ru}`,
    );
  }
  lines.push(
    `search_terms_en: ${caption.search_terms_en.join(", ")}`,
    `search_terms_ru: ${caption.search_terms_ru.join(", ")}`,
  );
  return lines.join("\n");
}

export function createPetVisionCaptionSourceHash(input: {
  captionRevision: string;
  modelUri: string;
  assetId: string;
  spritesheetSha256: string;
}): string {
  const pipeline =
    PET_VISION_PIPELINES[input.captionRevision] ?? V1_PIPELINE;
  const sharedParts = [
    input.captionRevision,
    input.modelUri,
    pipeline.systemPrompt,
    pipeline.userPrompt,
    JSON.stringify(pipeline.responseJsonSchema),
    pipeline.framePolicy.id,
    JSON.stringify(pipeline.framePolicy.frames),
  ];
  if (pipeline.schemaVersion === 2) {
    sharedParts.push(
      pipeline.api,
      pipeline.modelName,
      JSON.stringify(pipeline.tokenPolicy),
    );
  }
  return lengthPrefixedSha256([
    ...sharedParts,
    input.assetId,
    input.spritesheetSha256,
  ]);
}

export function createPetVisualEmbeddingSourceHash(input: {
  visualRevision: string;
  captionRevision: string;
  captionSourceHash: string;
  captionText: string;
}): string {
  return lengthPrefixedSha256([
    input.visualRevision,
    input.captionRevision,
    input.captionSourceHash,
    input.captionText,
  ]);
}

function parseEnvelopeValue(input: unknown): PetVisionCaptionEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("caption envelope must be an object.");
  }
  const schemaVersion = (input as { schemaVersion?: unknown }).schemaVersion;
  const envelope = strictObject(
    input,
    "caption envelope",
    schemaVersion === 2
      ? ["schemaVersion", "source", "provenance", "caption"]
      : ["schemaVersion", "source", "caption"],
  );
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    throw new Error("Caption envelope schemaVersion must be 1 or 2.");
  }
  const sourceValue = strictObject(envelope.source, "source", [
    "assetId",
    "spritesheetSha256",
  ]);
  const assetId = normalizedString(
    sourceValue.assetId,
    "source.assetId",
    1,
    256,
  );
  const spritesheetSha256 = normalizedString(
    sourceValue.spritesheetSha256,
    "source.spritesheetSha256",
    64,
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(spritesheetSha256)) {
    throw new Error("source.spritesheetSha256 must be lowercase SHA-256.");
  }

  const source = { assetId, spritesheetSha256 };
  if (schemaVersion === 1) {
    return {
      schemaVersion: 1,
      source,
      caption: parsePetVisionCaption(envelope.caption),
    };
  }
  const provenance = strictObject(envelope.provenance, "provenance", [
    "origin",
    "api",
    "model",
    "framePolicy",
  ]);
  if (
    provenance.origin !== "provider" ||
    provenance.api !== "responses" ||
    provenance.model !== V2_PIPELINE.modelName ||
    provenance.framePolicy !== V2_PIPELINE.framePolicy.id
  ) {
    throw new Error("Caption envelope contains invalid V2 provenance.");
  }
  return {
    schemaVersion: 2,
    source,
    provenance: {
      origin: "provider",
      api: "responses",
      model: "qwen3.6-35b-a3b",
      framePolicy: "pet-vision-nine-central-frames-v2",
    },
    caption: parsePetVisionCaptionForRevision(
      envelope.caption,
      PET_VISION_CAPTION_REVISION_V2,
    ) as PetVisionCaptionV2,
  };
}

function bilingualText(
  input: unknown,
  path: string,
  maxLength: number,
  required: boolean,
): BilingualText {
  const value = strictObject(input, path, ["en", "ru"]);
  return {
    en: normalizedString(value.en, `${path}.en`, required ? 1 : 0, maxLength),
    ru: normalizedString(value.ru, `${path}.ru`, required ? 1 : 0, maxLength),
  };
}

function stringList(
  input: unknown,
  path: string,
  minItems: number,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(input)) {
    throw new Error(`${path} must be an array.`);
  }
  if (input.length > maxItems) {
    throw new Error(`${path} must contain at most ${maxItems} items.`);
  }

  const seen = new Set<string>();
  const values: string[] = [];
  for (const [index, item] of input.entries()) {
    const normalized = normalizedString(
      item,
      `${path}[${index}]`,
      1,
      maxLength,
    );
    const key = normalized.toLocaleLowerCase("und");
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(normalized);
  }
  if (values.length < minItems) {
    throw new Error(`${path} must contain at least ${minItems} unique items.`);
  }
  return values;
}

function normalizedString(
  input: unknown,
  path: string,
  minLength: number,
  maxLength: number,
): string {
  if (typeof input !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  const value = input.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (value.length < minLength || value.length > maxLength) {
    throw new Error(
      `${path} must contain between ${minLength} and ${maxLength} characters.`,
    );
  }
  return value;
}

function strictObject<const T extends readonly string[]>(
  input: unknown,
  path: string,
  fields: T,
): Record<T[number], unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${path} must be an object.`);
  }
  const value = input as Record<string, unknown>;
  const allowed = new Set<string>(fields);
  const unknownField = Object.keys(value).find((key) => !allowed.has(key));
  if (unknownField) {
    throw new Error(`${path} contains unknown field ${unknownField}.`);
  }
  const missingField = fields.find(
    (field) => !Object.prototype.hasOwnProperty.call(value, field),
  );
  if (missingField) {
    throw new Error(`${path} is missing field ${missingField}.`);
  }
  return value as Record<T[number], unknown>;
}

function lengthPrefixedSha256(parts: readonly (string | Buffer)[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    const bytes = typeof part === "string" ? Buffer.from(part, "utf8") : part;
    const prefix = Buffer.allocUnsafe(4);
    prefix.writeUInt32BE(bytes.length);
    hash.update(prefix);
    hash.update(bytes);
  }
  return hash.digest("hex");
}
