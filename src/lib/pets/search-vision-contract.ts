import { createHash } from "node:crypto";

import { PET_VISION_FRAME_POLICY } from "@/lib/pets/search-vision-frames";

export const PET_VISION_CAPTION_REVISION_V1 =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v1";
export const PET_VISION_CAPTION_REVISION_V2 =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v2";
export const PET_VISION_CAPTION_REVISION_V3 =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v3";
export const PET_VISUAL_MODEL_REVISION_V1 =
  "yandex-text-search-2026-07-pet-vision-v1";
export const PET_VISUAL_MODEL_REVISION_V2 =
  "yandex-text-search-2026-07-pet-vision-v2";
export const PET_VISUAL_MODEL_REVISION_V3 =
  "yandex-text-search-2026-07-pet-vision-v3";

// Backward-compatible aliases remain pinned to v1. New deployments select v2
// explicitly until its revision-bound calibration profile is committed.
export const PET_VISION_CAPTION_REVISION =
  PET_VISION_CAPTION_REVISION_V1;
export const PET_VISUAL_MODEL_REVISION = PET_VISUAL_MODEL_REVISION_V1;

export const PET_VISION_SYSTEM_PROMPT_V1 =
  "You create internal search metadata for an animated software companion from four sprite frames. Describe only visible evidence. Do not infer or use identity, a character name, existing catalog metadata, hidden backstory, protected attributes, or an exact age. Use neutral language when uncertain. Describe visible subject type, appearance, clothing or accessories, art style, mood or pose, dominant colors, and concrete search concepts. Apply the same descriptive standard to every visual style; do not apply catalog-category or audience filters. English and Russian fields must be semantic equivalents. Output only JSON matching the supplied schema.";
export const PET_VISION_SYSTEM_PROMPT_V2 =
  "You create internal search metadata for an animated software companion from four sprite frames. Inspect every frame before answering and describe only visible evidence. Explicitly check the face and eyes, hair and headwear, clothing, handheld or worn objects, weapons, masks or other face and eye coverings, jewelry, horns, wings, tails, and other distinguishing accessories. Put every visible distinguishing object or covering in accessories even if it also appears in appearance or clothing. If a small detail is uncertain, describe it cautiously instead of inferring identity. Do not infer or use a character name, existing catalog metadata, hidden backstory, protected attributes, or an exact age. Use neutral language when uncertain. Describe visible subject type, appearance, clothing, accessories, art style, mood or pose, dominant colors, and concrete search concepts. Apply the same descriptive standard to every visual style; do not apply catalog-category or audience filters. English and Russian fields must be semantic equivalents. Output only JSON matching the supplied schema.";
export const PET_VISION_SYSTEM_PROMPT_V3 =
  "You create internal search metadata for an animated software companion from four sprite frames. Inspect all four frames before answering. For every one of these visual attribute slots, inspect the slot across all four frames: hair_and_headwear, face_and_eye_coverings, clothing_and_armor, weapons_and_objects, visible_effects, other_distinguishing_features. Each slot must contain exactly present, en, and ru: use present: true only when the attribute is visible and provide non-empty semantically equivalent English and Russian descriptions; use present: false only when the attribute is absent and leave both en and ru empty. Describe only visible evidence. Do not infer or use identity, a character name, name, slug, tags, description, existing catalog metadata, provenance, hidden backstory, protected attributes, or an exact age. Use neutral language when uncertain. Describe visible subject type, appearance, art style, mood or pose, dominant colors, and concrete search concepts. Apply the same descriptive standard to every visual style; do not apply catalog-category or audience filters. English and Russian fields must be semantic equivalents. Output only JSON matching the supplied schema.";

export const PET_VISION_USER_PROMPT =
  "The four images are ordered as idle, running-right, waving, and review. Produce the bilingual visual-search caption.";
export const PET_VISION_USER_PROMPT_V3 =
  "The four images are ordered as idle, running-right, waving, and review. Inspect each slot across all four frames in this order: hair_and_headwear, face_and_eye_coverings, clothing_and_armor, weapons_and_objects, visible_effects, other_distinguishing_features. Produce the bilingual presence-aware visual-search caption.";

export const PET_VISION_ATTRIBUTE_SLOTS_V3 = [
  "hair_and_headwear",
  "face_and_eye_coverings",
  "clothing_and_armor",
  "weapons_and_objects",
  "visible_effects",
  "other_distinguishing_features",
] as const;

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
    colors: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { $ref: "#/$defs/termList" },
        ru: { $ref: "#/$defs/termList" },
      },
    },
    search_terms_en: { $ref: "#/$defs/searchTermList" },
    search_terms_ru: { $ref: "#/$defs/searchTermList" },
  },
  $defs: {
    bilingualRequired: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { type: "string", minLength: 1, maxLength: 320 },
        ru: { type: "string", minLength: 1, maxLength: 320 },
      },
    },
    bilingualOptional: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { type: "string", maxLength: 240 },
        ru: { type: "string", maxLength: 240 },
      },
    },
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
  },
} as const;

export const PET_VISION_RESPONSE_JSON_SCHEMA_V2 = {
  type: "object",
  additionalProperties: false,
  required: [
    "subject",
    "appearance",
    "clothing",
    "accessories",
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
    accessories: { $ref: "#/$defs/bilingualOptional" },
    style: { $ref: "#/$defs/bilingualRequired" },
    mood: { $ref: "#/$defs/bilingualRequired" },
    colors: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { $ref: "#/$defs/termList" },
        ru: { $ref: "#/$defs/termList" },
      },
    },
    search_terms_en: { $ref: "#/$defs/searchTermList" },
    search_terms_ru: { $ref: "#/$defs/searchTermList" },
  },
  $defs: {
    bilingualRequired: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { type: "string", minLength: 1, maxLength: 320 },
        ru: { type: "string", minLength: 1, maxLength: 320 },
      },
    },
    bilingualOptional: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { type: "string", maxLength: 240 },
        ru: { type: "string", maxLength: 240 },
      },
    },
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
  },
} as const;

export const PET_VISION_RESPONSE_JSON_SCHEMA_V3 = {
  type: "object",
  additionalProperties: false,
  required: [
    "subject",
    "appearance",
    "visual_attributes",
    "style",
    "mood",
    "colors",
    "search_terms_en",
    "search_terms_ru",
  ],
  properties: {
    subject: { $ref: "#/$defs/bilingualRequired" },
    appearance: { $ref: "#/$defs/bilingualRequired" },
    visual_attributes: {
      type: "object",
      additionalProperties: false,
      required: PET_VISION_ATTRIBUTE_SLOTS_V3,
      properties: {
        hair_and_headwear: { $ref: "#/$defs/visualAttribute" },
        face_and_eye_coverings: { $ref: "#/$defs/visualAttribute" },
        clothing_and_armor: { $ref: "#/$defs/visualAttribute" },
        weapons_and_objects: { $ref: "#/$defs/visualAttribute" },
        visible_effects: { $ref: "#/$defs/visualAttribute" },
        other_distinguishing_features: {
          $ref: "#/$defs/visualAttribute",
        },
      },
    },
    style: { $ref: "#/$defs/bilingualRequired" },
    mood: { $ref: "#/$defs/bilingualRequired" },
    colors: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { $ref: "#/$defs/termList" },
        ru: { $ref: "#/$defs/termList" },
      },
    },
    search_terms_en: { $ref: "#/$defs/searchTermList" },
    search_terms_ru: { $ref: "#/$defs/searchTermList" },
  },
  $defs: {
    bilingualRequired: {
      type: "object",
      additionalProperties: false,
      required: ["en", "ru"],
      properties: {
        en: { type: "string", minLength: 1, maxLength: 320 },
        ru: { type: "string", minLength: 1, maxLength: 320 },
      },
    },
    visualAttribute: {
      type: "object",
      additionalProperties: false,
      required: ["present", "en", "ru"],
      properties: {
        present: { type: "boolean" },
        en: { type: "string", maxLength: 240 },
        ru: { type: "string", maxLength: 240 },
      },
    },
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
  },
} as const;

export const PET_VISION_CAPTION_CONTRACTS = {
  [PET_VISION_CAPTION_REVISION_V1]: {
    modelName: "qwen3.6-35b-a3b",
    schemaVersion: 1,
    responseSchemaName: "pet_visual_caption_v1",
    maxTokens: 900,
    systemPrompt: PET_VISION_SYSTEM_PROMPT_V1,
    userPrompt: PET_VISION_USER_PROMPT,
    responseJsonSchema: PET_VISION_RESPONSE_JSON_SCHEMA_V1,
  },
  [PET_VISION_CAPTION_REVISION_V2]: {
    modelName: "qwen3.6-35b-a3b",
    schemaVersion: 2,
    responseSchemaName: "pet_visual_caption_v2",
    maxTokens: 900,
    systemPrompt: PET_VISION_SYSTEM_PROMPT_V2,
    userPrompt: PET_VISION_USER_PROMPT,
    responseJsonSchema: PET_VISION_RESPONSE_JSON_SCHEMA_V2,
  },
  [PET_VISION_CAPTION_REVISION_V3]: {
    modelName: "qwen3.6-35b-a3b",
    schemaVersion: 3,
    responseSchemaName: "pet_visual_caption_v3",
    maxTokens: 1200,
    systemPrompt: PET_VISION_SYSTEM_PROMPT_V3,
    userPrompt: PET_VISION_USER_PROMPT_V3,
    responseJsonSchema: PET_VISION_RESPONSE_JSON_SCHEMA_V3,
  },
} as const;

export type PetVisionCaptionRevision =
  keyof typeof PET_VISION_CAPTION_CONTRACTS;

// Legacy exports keep v1 consumers source-compatible.
export const PET_VISION_SYSTEM_PROMPT = PET_VISION_SYSTEM_PROMPT_V1;
export const PET_VISION_RESPONSE_JSON_SCHEMA =
  PET_VISION_RESPONSE_JSON_SCHEMA_V1;

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
};

export type PetVisionAttributeV3 = {
  present: boolean;
  en: string;
  ru: string;
};

export type PetVisionCaptionV3 = {
  subject: BilingualText;
  appearance: BilingualText;
  visual_attributes: Record<
    (typeof PET_VISION_ATTRIBUTE_SLOTS_V3)[number],
    PetVisionAttributeV3
  >;
  style: BilingualText;
  mood: BilingualText;
  colors: { en: string[]; ru: string[] };
  search_terms_en: string[];
  search_terms_ru: string[];
};

export type PetVisionCaption =
  | PetVisionCaptionV1
  | PetVisionCaptionV2
  | PetVisionCaptionV3;

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
  caption: PetVisionCaptionV2;
};

export type PetVisionCaptionEnvelopeV3 = {
  schemaVersion: 3;
  source: {
    assetId: string;
    spritesheetSha256: string;
  };
  caption: PetVisionCaptionV3;
};

export type PetVisionCaptionEnvelope =
  | PetVisionCaptionEnvelopeV1
  | PetVisionCaptionEnvelopeV2
  | PetVisionCaptionEnvelopeV3;

const CAPTION_FIELDS_V1 = [
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
  "accessories",
  "style",
  "mood",
  "colors",
  "search_terms_en",
  "search_terms_ru",
] as const;

const CAPTION_FIELDS_V3 = [
  "subject",
  "appearance",
  "visual_attributes",
  "style",
  "mood",
  "colors",
  "search_terms_en",
  "search_terms_ru",
] as const;

export function getPetVisionCaptionContract(
  revision: string,
): (typeof PET_VISION_CAPTION_CONTRACTS)[PetVisionCaptionRevision] {
  if (!Object.hasOwn(PET_VISION_CAPTION_CONTRACTS, revision)) {
    throw new Error("Unsupported pet vision caption revision.");
  }
  return PET_VISION_CAPTION_CONTRACTS[
    revision as PetVisionCaptionRevision
  ];
}

export function parsePetVisionCaption(input: unknown): PetVisionCaptionV1;
export function parsePetVisionCaption(
  revision: typeof PET_VISION_CAPTION_REVISION_V1,
  input: unknown,
): PetVisionCaptionV1;
export function parsePetVisionCaption(
  revision: typeof PET_VISION_CAPTION_REVISION_V2,
  input: unknown,
): PetVisionCaptionV2;
export function parsePetVisionCaption(
  revision: typeof PET_VISION_CAPTION_REVISION_V3,
  input: unknown,
): PetVisionCaptionV3;
export function parsePetVisionCaption(
  revision: PetVisionCaptionRevision,
  input: unknown,
): PetVisionCaption;
export function parsePetVisionCaption(
  revisionOrInput: PetVisionCaptionRevision | unknown,
  input?: unknown,
): PetVisionCaption {
  const explicitRevision = arguments.length > 1;
  const revision = explicitRevision
    ? assertPetVisionCaptionRevision(revisionOrInput)
    : PET_VISION_CAPTION_REVISION_V1;
  const raw = explicitRevision ? input : revisionOrInput;
  const value = strictObject(
    raw,
    "caption",
    revision === PET_VISION_CAPTION_REVISION_V3
      ? CAPTION_FIELDS_V3
      : revision === PET_VISION_CAPTION_REVISION_V2
        ? CAPTION_FIELDS_V2
        : CAPTION_FIELDS_V1,
  );
  if (revision === PET_VISION_CAPTION_REVISION_V3) {
    const attributes = strictObject(
      value.visual_attributes,
      "visual_attributes",
      PET_VISION_ATTRIBUTE_SLOTS_V3,
    );
    return {
      subject: bilingualText(value.subject, "subject", 320, true),
      appearance: bilingualText(
        value.appearance,
        "appearance",
        320,
        true,
      ),
      visual_attributes: {
        hair_and_headwear: visualAttributeV3(
          attributes.hair_and_headwear,
          "visual_attributes.hair_and_headwear",
        ),
        face_and_eye_coverings: visualAttributeV3(
          attributes.face_and_eye_coverings,
          "visual_attributes.face_and_eye_coverings",
        ),
        clothing_and_armor: visualAttributeV3(
          attributes.clothing_and_armor,
          "visual_attributes.clothing_and_armor",
        ),
        weapons_and_objects: visualAttributeV3(
          attributes.weapons_and_objects,
          "visual_attributes.weapons_and_objects",
        ),
        visible_effects: visualAttributeV3(
          attributes.visible_effects,
          "visual_attributes.visible_effects",
        ),
        other_distinguishing_features: visualAttributeV3(
          attributes.other_distinguishing_features,
          "visual_attributes.other_distinguishing_features",
        ),
      },
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
  }
  const caption: PetVisionCaptionV1 = {
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
  if (revision === PET_VISION_CAPTION_REVISION_V2) {
    return {
      ...caption,
      accessories: bilingualText(
        value.accessories,
        "accessories",
        240,
        false,
      ),
    };
  }
  return caption;
}

export function createPetVisionCaptionEnvelope(input: {
  captionRevision?: typeof PET_VISION_CAPTION_REVISION_V1;
  assetId: string;
  spritesheetSha256: string;
  caption: PetVisionCaptionV1;
}): PetVisionCaptionEnvelopeV1;
export function createPetVisionCaptionEnvelope(input: {
  captionRevision: typeof PET_VISION_CAPTION_REVISION_V2;
  assetId: string;
  spritesheetSha256: string;
  caption: PetVisionCaptionV2;
}): PetVisionCaptionEnvelopeV2;
export function createPetVisionCaptionEnvelope(input: {
  captionRevision: typeof PET_VISION_CAPTION_REVISION_V3;
  assetId: string;
  spritesheetSha256: string;
  caption: PetVisionCaptionV3;
}): PetVisionCaptionEnvelopeV3;
export function createPetVisionCaptionEnvelope(input: {
  captionRevision: PetVisionCaptionRevision;
  assetId: string;
  spritesheetSha256: string;
  caption: PetVisionCaption;
}): PetVisionCaptionEnvelope;
export function createPetVisionCaptionEnvelope(input: {
  captionRevision?: PetVisionCaptionRevision;
  assetId: string;
  spritesheetSha256: string;
  caption: PetVisionCaption;
}): PetVisionCaptionEnvelope {
  const revision =
    input.captionRevision ?? PET_VISION_CAPTION_REVISION_V1;
  const contract = getPetVisionCaptionContract(revision);
  return parseEnvelopeValue(revision, {
    schemaVersion: contract.schemaVersion,
    source: {
      assetId: input.assetId,
      spritesheetSha256: input.spritesheetSha256,
    },
    caption: input.caption,
  });
}

export function parsePetVisionCaptionEnvelope(
  value: string,
): PetVisionCaptionEnvelopeV1;
export function parsePetVisionCaptionEnvelope(
  revision: typeof PET_VISION_CAPTION_REVISION_V1,
  value: string,
): PetVisionCaptionEnvelopeV1;
export function parsePetVisionCaptionEnvelope(
  revision: typeof PET_VISION_CAPTION_REVISION_V2,
  value: string,
): PetVisionCaptionEnvelopeV2;
export function parsePetVisionCaptionEnvelope(
  revision: typeof PET_VISION_CAPTION_REVISION_V3,
  value: string,
): PetVisionCaptionEnvelopeV3;
export function parsePetVisionCaptionEnvelope(
  revision: PetVisionCaptionRevision,
  value: string,
): PetVisionCaptionEnvelope;
export function parsePetVisionCaptionEnvelope(
  revisionOrValue: PetVisionCaptionRevision | string,
  value?: string,
): PetVisionCaptionEnvelope {
  const explicitRevision = arguments.length > 1;
  const revision = explicitRevision
    ? assertPetVisionCaptionRevision(revisionOrValue)
    : PET_VISION_CAPTION_REVISION_V1;
  const json = explicitRevision ? value : revisionOrValue;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json ?? "");
  } catch {
    throw new Error("Caption envelope must contain one JSON object.");
  }
  return parseEnvelopeValue(revision, parsed);
}

export function buildPetVisionCaptionText(
  caption: PetVisionCaptionV1,
): string;
export function buildPetVisionCaptionText(
  revision: typeof PET_VISION_CAPTION_REVISION_V1,
  caption: PetVisionCaptionV1,
): string;
export function buildPetVisionCaptionText(
  revision: typeof PET_VISION_CAPTION_REVISION_V2,
  caption: PetVisionCaptionV2,
): string;
export function buildPetVisionCaptionText(
  revision: typeof PET_VISION_CAPTION_REVISION_V3,
  caption: PetVisionCaptionV3,
): string;
export function buildPetVisionCaptionText(
  revision: PetVisionCaptionRevision,
  caption: PetVisionCaption,
): string;
export function buildPetVisionCaptionText(
  revisionOrCaption: PetVisionCaptionRevision | PetVisionCaption,
  caption?: PetVisionCaption,
): string {
  const explicitRevision = arguments.length > 1;
  const revision = explicitRevision
    ? assertPetVisionCaptionRevision(revisionOrCaption)
    : PET_VISION_CAPTION_REVISION_V1;
  const value = (explicitRevision ? caption : revisionOrCaption) as
    | PetVisionCaptionV1
    | PetVisionCaptionV2
    | PetVisionCaptionV3;
  if (revision === PET_VISION_CAPTION_REVISION_V3) {
    if (!("visual_attributes" in value)) {
      throw new Error("V3 caption must contain visual_attributes.");
    }
    const lines = [
      `subject_en: ${value.subject.en}`,
      `subject_ru: ${value.subject.ru}`,
      `appearance_en: ${value.appearance.en}`,
      `appearance_ru: ${value.appearance.ru}`,
    ];
    for (const slot of PET_VISION_ATTRIBUTE_SLOTS_V3) {
      const attribute = value.visual_attributes[slot];
      lines.push(
        `${slot}_en: ${attribute.en}`,
        `${slot}_ru: ${attribute.ru}`,
      );
    }
    lines.push(
      `style_en: ${value.style.en}`,
      `style_ru: ${value.style.ru}`,
      `mood_en: ${value.mood.en}`,
      `mood_ru: ${value.mood.ru}`,
      `colors_en: ${value.colors.en.join(", ")}`,
      `colors_ru: ${value.colors.ru.join(", ")}`,
      `search_terms_en: ${value.search_terms_en.join(", ")}`,
      `search_terms_ru: ${value.search_terms_ru.join(", ")}`,
    );
    return lines.join("\n");
  }
  const legacyValue = value as PetVisionCaptionV1 | PetVisionCaptionV2;
  const lines = [
    `subject_en: ${legacyValue.subject.en}`,
    `subject_ru: ${legacyValue.subject.ru}`,
    `appearance_en: ${legacyValue.appearance.en}`,
    `appearance_ru: ${legacyValue.appearance.ru}`,
    `clothing_en: ${legacyValue.clothing.en}`,
    `clothing_ru: ${legacyValue.clothing.ru}`,
  ];
  if (revision === PET_VISION_CAPTION_REVISION_V2) {
    if (!("accessories" in legacyValue)) {
      throw new Error("V2 caption must contain accessories.");
    }
    lines.push(
      `accessories_en: ${legacyValue.accessories.en}`,
      `accessories_ru: ${legacyValue.accessories.ru}`,
    );
  }
  lines.push(
    `style_en: ${legacyValue.style.en}`,
    `style_ru: ${legacyValue.style.ru}`,
    `mood_en: ${legacyValue.mood.en}`,
    `mood_ru: ${legacyValue.mood.ru}`,
    `colors_en: ${legacyValue.colors.en.join(", ")}`,
    `colors_ru: ${legacyValue.colors.ru.join(", ")}`,
    `search_terms_en: ${legacyValue.search_terms_en.join(", ")}`,
    `search_terms_ru: ${legacyValue.search_terms_ru.join(", ")}`,
  );
  return lines.join("\n");
}

export function createPetVisionCaptionSourceHash(input: {
  captionRevision: string;
  modelUri: string;
  assetId: string;
  spritesheetSha256: string;
}): string {
  const contract = getPetVisionCaptionContract(input.captionRevision);
  return lengthPrefixedSha256([
    input.captionRevision,
    input.modelUri,
    contract.systemPrompt,
    contract.userPrompt,
    JSON.stringify(contract.responseJsonSchema),
    PET_VISION_FRAME_POLICY.id,
    JSON.stringify(PET_VISION_FRAME_POLICY.frames),
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

function parseEnvelopeValue(
  revision: PetVisionCaptionRevision,
  input: unknown,
): PetVisionCaptionEnvelope {
  const contract = getPetVisionCaptionContract(revision);
  const envelope = strictObject(input, "caption envelope", [
    "schemaVersion",
    "source",
    "caption",
  ]);
  if (envelope.schemaVersion !== contract.schemaVersion) {
    throw new Error(
      `Caption envelope schemaVersion must be ${contract.schemaVersion}.`,
    );
  }
  const source = strictObject(envelope.source, "source", [
    "assetId",
    "spritesheetSha256",
  ]);
  const assetId = normalizedString(source.assetId, "source.assetId", 1, 256);
  const spritesheetSha256 = normalizedString(
    source.spritesheetSha256,
    "source.spritesheetSha256",
    64,
    64,
  ).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(spritesheetSha256)) {
    throw new Error("source.spritesheetSha256 must be lowercase SHA-256.");
  }

  if (revision === PET_VISION_CAPTION_REVISION_V3) {
    return {
      schemaVersion: 3,
      source: { assetId, spritesheetSha256 },
      caption: parsePetVisionCaption(revision, envelope.caption),
    };
  }
  if (revision === PET_VISION_CAPTION_REVISION_V2) {
    return {
      schemaVersion: 2,
      source: { assetId, spritesheetSha256 },
      caption: parsePetVisionCaption(revision, envelope.caption),
    };
  }
  return {
    schemaVersion: 1,
    source: { assetId, spritesheetSha256 },
    caption: parsePetVisionCaption(revision, envelope.caption),
  };
}

function visualAttributeV3(
  input: unknown,
  path: string,
): PetVisionAttributeV3 {
  const value = strictObject(input, path, ["present", "en", "ru"]);
  if (typeof value.present !== "boolean") {
    throw new Error(`${path}.present must be a boolean.`);
  }
  const en = normalizedString(value.en, `${path}.en`, 0, 240);
  const ru = normalizedString(value.ru, `${path}.ru`, 0, 240);
  if (value.present && (!en || !ru)) {
    throw new Error(`${path} present attributes require non-empty en and ru.`);
  }
  if (!value.present && (en || ru)) {
    throw new Error(`${path} absent attributes require empty en and ru.`);
  }
  return { present: value.present, en, ru };
}

function assertPetVisionCaptionRevision(
  value: unknown,
): PetVisionCaptionRevision {
  if (
    typeof value !== "string" ||
    !Object.hasOwn(PET_VISION_CAPTION_CONTRACTS, value)
  ) {
    throw new Error("Unsupported pet vision caption revision.");
  }
  return value as PetVisionCaptionRevision;
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
