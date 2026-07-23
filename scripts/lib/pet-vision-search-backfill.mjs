import { createHash } from "node:crypto";

import sharp from "sharp";

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export const PET_VISION_FRAME_POLICY = {
  id: "pet-vision-central-frames-v1",
  frames: [
    { state: "idle", row: 0, frameCount: 6, frame: 3 },
    { state: "running-right", row: 1, frameCount: 8, frame: 4 },
    { state: "waving", row: 3, frameCount: 4, frame: 2 },
    { state: "review", row: 8, frameCount: 6, frame: 3 },
  ],
};

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
];

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
};

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
};

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
};

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
};

export const PET_VISUAL_MODEL_REVISIONS = {
  [PET_VISUAL_MODEL_REVISION_V1]: {
    captionRevision: PET_VISION_CAPTION_REVISION_V1,
    dimensions: 256,
  },
  [PET_VISUAL_MODEL_REVISION_V2]: {
    captionRevision: PET_VISION_CAPTION_REVISION_V2,
    dimensions: 256,
  },
  [PET_VISUAL_MODEL_REVISION_V3]: {
    captionRevision: PET_VISION_CAPTION_REVISION_V3,
    dimensions: 256,
  },
};

const DARK_EYE_COVERING_TERMS = [
  "dark eye covering",
  "black eye covering",
  "eye covering",
  "one eye covered",
  "covered eye",
  "eye patch",
  "eyepatch",
  "blindfold",
  "повязка на глаз",
  "чёрная повязка",
  "черная повязка",
  "закрытый глаз",
  "один глаз закрыт",
];

const DARK_OUTFIT_TERMS = [
  "black outfit",
  "dark outfit",
  "black clothing",
  "dark clothing",
  "black dress",
  "чёрный наряд",
  "черный наряд",
  "тёмный наряд",
  "темный наряд",
  "чёрная одежда",
  "черная одежда",
  "чёрное платье",
  "черное платье",
];

export const PET_VISION_V2_CANARIES = [
  {
    slug: "fischl-detailed",
    expectations: [
      {
        id: "blonde_hair",
        expectedAnyTerms: [
          "blonde hair",
          "blond hair",
          "fair hair",
          "белокурые волосы",
          "светлые волосы",
          "волосы блонд",
        ],
      },
      {
        id: "dark_eye_covering",
        expectedAnyTerms: DARK_EYE_COVERING_TERMS,
      },
      {
        id: "purple_outfit",
        expectedAnyTerms: [
          "purple outfit",
          "violet outfit",
          "purple clothing",
          "violet clothing",
          "purple dress",
          "фиолетовый наряд",
          "фиолетовая одежда",
          "фиолетовое платье",
          "пурпурный наряд",
        ],
      },
      {
        id: "dark_outfit",
        expectedAnyTerms: DARK_OUTFIT_TERMS,
      },
    ],
  },
  {
    slug: "2b-2",
    expectations: [
      {
        id: "silver_hair",
        expectedAnyTerms: [
          "silver hair",
          "silver white hair",
          "white silver hair",
          "серебристые волосы",
          "серебряные волосы",
          "серебристо белые волосы",
        ],
      },
      {
        id: "dark_eye_covering",
        expectedAnyTerms: DARK_EYE_COVERING_TERMS,
      },
      {
        id: "dark_outfit",
        expectedAnyTerms: DARK_OUTFIT_TERMS,
      },
      {
        id: "sword",
        expectedAnyTerms: [
          "sword",
          "blade",
          "katana",
          "меч",
          "клинок",
          "катана",
        ],
      },
    ],
  },
  {
    slug: "master-of-terra",
    expectations: [
      {
        id: "golden_armor",
        expectedAnyTerms: [
          "golden armor",
          "gold armor",
          "ornate golden armour",
          "золотая броня",
          "золотые доспехи",
        ],
      },
      {
        id: "red_cloak",
        expectedAnyTerms: [
          "red cloak",
          "red cape",
          "red mantle",
          "красный плащ",
          "красная мантия",
          "красная накидка",
        ],
      },
      {
        id: "flaming_sword",
        expectedAnyTerms: [
          "flaming sword",
          "burning sword",
          "fiery sword",
          "sword in flames",
          "огненный меч",
          "пылающий меч",
          "горящий меч",
          "меч в огне",
        ],
      },
    ],
  },
  {
    slug: "vi",
    expectations: [
      {
        id: "magenta_hair",
        expectedAnyTerms: [
          "magenta hair",
          "fuchsia hair",
          "pink hair",
          "пурпурные волосы",
          "малиновые волосы",
          "розовые волосы",
        ],
      },
      {
        id: "oversized_gauntlets",
        expectedAnyTerms: [
          "oversized gauntlets",
          "massive gauntlets",
          "huge gauntlets",
          "large gauntlets",
          "oversized mechanical gauntlets",
          "массивные перчатки",
          "огромные перчатки",
          "большие рукавицы",
          "массивные рукавицы",
        ],
      },
    ],
  },
];

const DARK_EYE_COVERING_TERMS_EN_V3 = [
  "dark eye covering",
  "black eye covering",
  "dark eye patch",
  "black eye patch",
  "dark eyepatch",
  "black eyepatch",
  "dark blindfold",
  "black blindfold",
];
const DARK_EYE_COVERING_TERMS_RU_V3 = [
  "чёрная повязка на глаз",
  "черная повязка на глаз",
  "тёмная повязка на глаз",
  "темная повязка на глаз",
  "чёрная повязка",
  "черная повязка",
  "тёмная повязка",
  "темная повязка",
];
const DARK_OUTFIT_TERMS_EN_V3 = [
  "black outfit",
  "dark outfit",
  "black clothing",
  "dark clothing",
  "black dress",
];
const DARK_OUTFIT_TERMS_RU_V3 = [
  "чёрный наряд",
  "черный наряд",
  "тёмный наряд",
  "темный наряд",
  "чёрная одежда",
  "черная одежда",
  "чёрное платье",
  "черное платье",
];

export const PET_VISION_V3_CANARIES = [
  {
    slug: "fischl-detailed",
    expectations: [
      {
        id: "blonde_hair",
        slot: "hair_and_headwear",
        expectedAnyTermsEn: ["blonde hair", "blond hair", "fair hair"],
        expectedAnyTermsRu: [
          "белокурые волосы",
          "светлые волосы",
          "волосы блонд",
        ],
      },
      {
        id: "dark_eye_covering",
        slot: "face_and_eye_coverings",
        expectedAnyTermsEn: DARK_EYE_COVERING_TERMS_EN_V3,
        expectedAnyTermsRu: DARK_EYE_COVERING_TERMS_RU_V3,
      },
      {
        id: "purple_outfit",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: [
          "purple outfit",
          "violet outfit",
          "purple clothing",
          "violet clothing",
          "purple dress",
        ],
        expectedAnyTermsRu: [
          "фиолетовый наряд",
          "фиолетовая одежда",
          "фиолетовое платье",
          "пурпурный наряд",
        ],
      },
      {
        id: "dark_outfit",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: DARK_OUTFIT_TERMS_EN_V3,
        expectedAnyTermsRu: DARK_OUTFIT_TERMS_RU_V3,
      },
    ],
  },
  {
    slug: "2b-2",
    expectations: [
      {
        id: "silver_hair",
        slot: "hair_and_headwear",
        expectedAnyTermsEn: [
          "silver hair",
          "silver white hair",
          "white silver hair",
        ],
        expectedAnyTermsRu: [
          "серебристые волосы",
          "серебряные волосы",
          "серебристо белые волосы",
        ],
      },
      {
        id: "dark_eye_covering",
        slot: "face_and_eye_coverings",
        expectedAnyTermsEn: DARK_EYE_COVERING_TERMS_EN_V3,
        expectedAnyTermsRu: DARK_EYE_COVERING_TERMS_RU_V3,
      },
      {
        id: "dark_outfit",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: DARK_OUTFIT_TERMS_EN_V3,
        expectedAnyTermsRu: DARK_OUTFIT_TERMS_RU_V3,
      },
      {
        id: "sword",
        slot: "weapons_and_objects",
        expectedAnyTermsEn: ["sword", "blade", "katana"],
        expectedAnyTermsRu: ["меч", "клинок", "катана"],
      },
    ],
  },
  {
    slug: "master-of-terra",
    expectations: [
      {
        id: "golden_armor",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: [
          "golden armor",
          "gold armor",
          "ornate golden armour",
        ],
        expectedAnyTermsRu: ["золотая броня", "золотые доспехи"],
      },
      {
        id: "red_cloak",
        slot: "clothing_and_armor",
        expectedAnyTermsEn: ["red cloak", "red cape", "red mantle"],
        expectedAnyTermsRu: [
          "красный плащ",
          "красная мантия",
          "красная накидка",
        ],
      },
      {
        id: "sword",
        slot: "weapons_and_objects",
        expectedAnyTermsEn: ["sword", "blade"],
        expectedAnyTermsRu: ["меч", "клинок"],
      },
      {
        id: "flame_effect",
        slot: "visible_effects",
        expectedAnyTermsEn: ["fire", "flame", "flames", "burning", "fiery"],
        expectedAnyTermsRu: [
          "огонь",
          "пламя",
          "горящий",
          "пылающий",
          "огненный",
        ],
      },
    ],
  },
  {
    slug: "vi",
    expectations: [
      {
        id: "magenta_hair",
        slot: "hair_and_headwear",
        expectedAnyTermsEn: ["magenta hair", "fuchsia hair", "pink hair"],
        expectedAnyTermsRu: [
          "пурпурные волосы",
          "малиновые волосы",
          "розовые волосы",
        ],
      },
      {
        id: "oversized_gauntlets",
        slot: "weapons_and_objects",
        expectedAnyTermsEn: [
          "oversized gauntlets",
          "massive gauntlets",
          "huge gauntlets",
          "large gauntlets",
          "oversized mechanical gauntlets",
        ],
        expectedAnyTermsRu: [
          "массивные перчатки",
          "огромные перчатки",
          "большие рукавицы",
          "массивные рукавицы",
        ],
      },
    ],
  },
];

export const PET_VISION_SYSTEM_PROMPT = PET_VISION_SYSTEM_PROMPT_V1;
export const PET_VISION_RESPONSE_JSON_SCHEMA =
  PET_VISION_RESPONSE_JSON_SCHEMA_V1;

const SHEETS = {
  1: { width: 1536, height: 1872, cellWidth: 192, cellHeight: 208 },
  2: { width: 1536, height: 2288, cellWidth: 192, cellHeight: 208 },
};
const CAPTION_FIELDS_V1 = [
  "subject",
  "appearance",
  "clothing",
  "style",
  "mood",
  "colors",
  "search_terms_en",
  "search_terms_ru",
];
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
];
const CAPTION_FIELDS_V3 = [
  "subject",
  "appearance",
  "visual_attributes",
  "style",
  "mood",
  "colors",
  "search_terms_en",
  "search_terms_ru",
];
const SAFE_FAILURE_REASONS = new Set([
  "asset_error",
  "authentication_error",
  "canary_failed",
  "configuration_missing",
  "embedding_error",
  "full_backfill_deferred",
  "invalid_request",
  "invalid_response",
  "persistence_error",
  "provider_error",
  "rate_limited",
  "refused",
  "timeout",
]);

export class PetVisionBackfillError extends Error {
  constructor(reason, canary = null) {
    super("Pet vision search backfill failed.");
    this.name = "PetVisionBackfillError";
    this.reason = reason;
    this.canary = canary;
  }
}

export function resolvePetVisionRevisionConfig(
  captionRevision,
  visualRevision,
) {
  const captionContract = PET_VISION_CAPTION_CONTRACTS[captionRevision];
  const visualConfig = PET_VISUAL_MODEL_REVISIONS[visualRevision];
  if (
    !captionContract ||
    !visualConfig ||
    visualConfig.captionRevision !== captionRevision
  ) {
    throw new Error(
      "Configure registered matching caption and visual revisions.",
    );
  }
  return {
    captionRevision,
    visualRevision,
    dimensions: visualConfig.dimensions,
    captionContract,
  };
}

export function assertPetVisionBackfillInvocationPolicy(options, config) {
  if (
    isRegisteredV3BackfillConfig(config) &&
    options.mode === "apply" &&
    !options.canaries &&
    !options.slug
  ) {
    throw new PetVisionBackfillError("full_backfill_deferred");
  }
}

export function evaluatePetVisionCanary(slug, captionText) {
  const canary = PET_VISION_V2_CANARIES.find(
    (candidate) => candidate.slug === slug,
  );
  if (!canary) return null;

  const normalizedCaption = normalizeCanaryText(captionText);
  const checks = canary.expectations.map((expectation) => ({
    id: expectation.id,
    passed: expectation.expectedAnyTerms.some((term) =>
      containsCanaryTerm(
        normalizedCaption,
        normalizeCanaryText(term),
      ),
    ),
  }));
  return {
    slug,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export function evaluatePetVisionV3Canary(slug, caption) {
  const canary = PET_VISION_V3_CANARIES.find(
    (candidate) => candidate.slug === slug,
  );
  if (!canary) return null;

  const checks = canary.expectations.map((expectation) => {
    const slot = caption.visual_attributes[expectation.slot];
    const normalizedEn = normalizeCanaryText(slot.en);
    const normalizedRu = normalizeCanaryText(slot.ru);
    return {
      id: expectation.id,
      passed:
        slot.present === true &&
        (expectation.expectedAnyTermsEn.some((term) =>
          containsCanaryTerm(
            normalizedEn,
            normalizeCanaryText(term),
          ),
        ) ||
          expectation.expectedAnyTermsRu.some((term) =>
            containsCanaryTerm(
              normalizedRu,
              normalizeCanaryText(term),
            ),
          )),
    };
  });
  return {
    slug,
    passed: checks.every((check) => check.passed),
    checks,
  };
}

export function parseVisionBackfillArgs(argv) {
  let mode = null;
  let slug = null;
  let force = false;
  let canaries = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run" || argument === "--apply") {
      const nextMode = argument === "--dry-run" ? "dry-run" : "apply";
      if (mode && mode !== nextMode) {
        throw new Error("Pass exactly one of --dry-run or --apply.");
      }
      mode = nextMode;
      continue;
    }
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--canaries") {
      canaries = true;
      continue;
    }
    if (argument === "--slug" || argument?.startsWith("--slug=")) {
      const value = argument === "--slug"
        ? argv[index += 1]
        : argument.slice("--slug=".length);
      if (!value || !SAFE_SLUG.test(value)) {
        throw new Error("--slug must be a valid public pet slug.");
      }
      slug = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument ?? ""}`);
  }

  if (!mode) {
    throw new Error("Pass exactly one of --dry-run or --apply.");
  }
  if (force && mode !== "apply") {
    throw new Error("--force is valid only with --apply.");
  }
  if (canaries && slug) {
    throw new Error("--canaries cannot be combined with --slug.");
  }
  return { mode, slug, force, canaries };
}

export async function extractPetVisionFrames(spritesheet) {
  if (!hasSupportedSpriteSignature(spritesheet)) {
    throw new Error("Unsupported sprite image format; expected PNG or WebP.");
  }

  const metadata = await sharp(spritesheet).metadata();
  const sheetEntry = Object.entries(SHEETS).find(
    ([, sheet]) =>
      sheet.width === metadata.width && sheet.height === metadata.height,
  );
  if (!sheetEntry) {
    throw new Error(
      `Unsupported sprite atlas dimensions: ${metadata.width ?? 0}x${metadata.height ?? 0}.`,
    );
  }
  const [spriteVersion, sheet] = sheetEntry;
  const frames = await Promise.all(
    PET_VISION_FRAME_POLICY.frames.map(async (selected) => {
      const png = await sharp(spritesheet)
        .extract({
          left: selected.frame * sheet.cellWidth,
          top: selected.row * sheet.cellHeight,
          width: sheet.cellWidth,
          height: sheet.cellHeight,
        })
        .png()
        .toBuffer();
      return {
        state: selected.state,
        row: selected.row,
        frame: selected.frame,
        png,
        dataUrl: `data:image/png;base64,${png.toString("base64")}`,
      };
    }),
  );

  return {
    spriteVersion: Number(spriteVersion),
    spritesheetSha256: createHash("sha256")
      .update(spritesheet)
      .digest("hex"),
    frames,
  };
}

function hasSupportedSpriteSignature(buffer) {
  const isPng =
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  const isWebp =
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP";

  return isPng || isWebp;
}

export function parsePetVisionCaption(revisionOrInput, input) {
  const explicitRevision = arguments.length > 1;
  const revision = explicitRevision
    ? assertCaptionRevision(revisionOrInput)
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
      visual_attributes: Object.fromEntries(
        PET_VISION_ATTRIBUTE_SLOTS_V3.map((slot) => [
          slot,
          visualAttributeV3(
            attributes[slot],
            `visual_attributes.${slot}`,
          ),
        ]),
      ),
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
  const caption = {
    subject: bilingualText(value.subject, "subject", 320, true),
    appearance: bilingualText(
      value.appearance,
      "appearance",
      320,
      true,
    ),
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

export function createPetVisionCaptionEnvelope(input) {
  const revision =
    input.captionRevision ?? PET_VISION_CAPTION_REVISION_V1;
  const contract = getCaptionContract(revision);
  return parseEnvelopeValue(revision, {
    schemaVersion: contract.schemaVersion,
    source: {
      assetId: input.assetId,
      spritesheetSha256: input.spritesheetSha256,
    },
    caption: input.caption,
  });
}

export function parsePetVisionCaptionEnvelope(revisionOrValue, value) {
  const explicitRevision = arguments.length > 1;
  const revision = explicitRevision
    ? assertCaptionRevision(revisionOrValue)
    : PET_VISION_CAPTION_REVISION_V1;
  const json = explicitRevision ? value : revisionOrValue;
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Caption envelope must contain one JSON object.");
  }
  return parseEnvelopeValue(revision, parsed);
}

export function buildPetVisionCaptionText(revisionOrCaption, caption) {
  const explicitRevision = arguments.length > 1;
  const revision = explicitRevision
    ? assertCaptionRevision(revisionOrCaption)
    : PET_VISION_CAPTION_REVISION_V1;
  const value = explicitRevision ? caption : revisionOrCaption;
  const lines = [
    `subject_en: ${value.subject.en}`,
    `subject_ru: ${value.subject.ru}`,
    `appearance_en: ${value.appearance.en}`,
    `appearance_ru: ${value.appearance.ru}`,
  ];
  if (revision === PET_VISION_CAPTION_REVISION_V3) {
    if (!value.visual_attributes) {
      throw new Error("V3 caption must contain visual_attributes.");
    }
    for (const slot of PET_VISION_ATTRIBUTE_SLOTS_V3) {
      lines.push(
        `${slot}_en: ${value.visual_attributes[slot].en}`,
        `${slot}_ru: ${value.visual_attributes[slot].ru}`,
      );
    }
  } else {
    lines.push(
      `clothing_en: ${value.clothing.en}`,
      `clothing_ru: ${value.clothing.ru}`,
    );
  }
  if (revision === PET_VISION_CAPTION_REVISION_V2) {
    if (!value.accessories) {
      throw new Error("V2 caption must contain accessories.");
    }
    lines.push(
      `accessories_en: ${value.accessories.en}`,
      `accessories_ru: ${value.accessories.ru}`,
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

export function createPetVisionCaptionSourceHash(input) {
  const contract = getCaptionContract(input.captionRevision);
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

export function createPetVisualEmbeddingSourceHash(input) {
  return lengthPrefixedSha256([
    input.visualRevision,
    input.captionRevision,
    input.captionSourceHash,
    input.captionText,
  ]);
}

export function embeddingToBuffer(embedding) {
  const buffer = Buffer.allocUnsafe(
    embedding.length * Float32Array.BYTES_PER_ELEMENT + 1,
  );
  embedding.forEach((value, index) => {
    buffer.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT);
  });
  buffer[buffer.length - 1] = 0x01;
  return buffer;
}

export async function runPetVisionSearchBackfill(input) {
  assertPetVisionBackfillInvocationPolicy(input.options, input.config);
  const isV3 = isRegisteredV3BackfillConfig(input.config);
  const approvedPets = input.pets.filter(
    (candidate) => !candidate.status || candidate.status === "approved",
  );
  if (input.options.canaries && !isV3) {
    throw new Error("--canaries is valid only for the registered v3 pair.");
  }
  if (
    isV3 &&
    input.options.slug &&
    PET_VISION_V3_CANARIES.some(
      (canary) => canary.slug === input.options.slug,
    )
  ) {
    throw new Error("Individual v3 canary slug execution is not allowed.");
  }
  if (input.options.canaries) {
    const canaryPets = selectV3CanaryPets(input, approvedPets);
    if (input.options.mode === "dry-run") {
      await prepareV3CanarySources(input, canaryPets);
      const summary = {
        scanned: canaryPets.length,
        unchanged: 0,
        vectorOnly: 0,
        captionAndVector: canaryPets.length,
      };
      for (const pet of canaryPets) {
        input.log({ slug: pet.slug, action: "planned" });
      }
      input.log({ action: "summary", ...summary });
      return summary;
    }
    return runV3CanaryBatch(input, canaryPets);
  }

  let currentApprovedPets = approvedPets;
  if (
    isV3 &&
    input.options.mode === "apply"
  ) {
    currentApprovedPets = await listCurrentApprovedPets(input);
    if (!(await isV3DurableGateOpen(input, currentApprovedPets))) {
      throw new PetVisionBackfillError("canary_failed", {
        slug: "v3-canary-gate",
        passed: false,
        checks: [{ id: "durable_gate", passed: false }],
      });
    }
  }

  const ordinaryApprovedPets = isV3
    ? currentApprovedPets.filter(
        (candidate) =>
          !PET_VISION_V3_CANARIES.some(
            (canary) => canary.slug === candidate.slug,
          ),
      )
    : approvedPets;
  const selectedPets = input.options.slug
    ? ordinaryApprovedPets.filter(
        (candidate) => candidate.slug === input.options.slug,
      )
    : ordinaryApprovedPets;
  if (input.options.slug && selectedPets.length === 0) {
    throw new Error(`Approved pet slug not found: ${input.options.slug}`);
  }
  const orderedPets = orderPetsForCanaryGate(input, selectedPets);

  const summary = {
    scanned: selectedPets.length,
    unchanged: 0,
    vectorOnly: 0,
    captionAndVector: 0,
  };

  for (const pet of orderedPets) {
    try {
      const action = await processPet(input, pet);
      if (action === "unchanged") summary.unchanged += 1;
      if (action === "vector-only") summary.vectorOnly += 1;
      if (action === "caption-and-vector") {
        summary.captionAndVector += 1;
      }
      input.log({ slug: pet.slug, action });
    } catch (error) {
      const failure = safeFailure(error);
      input.log({
        slug: pet.slug,
        action: "failed",
        reason: failure.reason,
      });
      throw failure;
    }
  }

  input.log({ action: "summary", ...summary });
  return summary;
}

function isRegisteredV3BackfillConfig(config) {
  return (
    config.captionRevision === PET_VISION_CAPTION_REVISION_V3 &&
    config.visualRevision === PET_VISUAL_MODEL_REVISION_V3 &&
    config.dimensions ===
      PET_VISUAL_MODEL_REVISIONS[PET_VISUAL_MODEL_REVISION_V3].dimensions
  );
}

function selectV3CanaryPets(input, approvedPets) {
  const petsBySlug = new Map(
    approvedPets.map((candidate) => [candidate.slug, candidate]),
  );
  return PET_VISION_V3_CANARIES.map((canary) => {
    const pet = petsBySlug.get(canary.slug);
    if (pet) return pet;
    const result = {
      slug: canary.slug,
      passed: false,
      checks: [{ id: "approved_pet_present", passed: false }],
    };
    input.log({ slug: canary.slug, action: "canary", canary: result });
    throw new PetVisionBackfillError("canary_failed", result);
  });
}

async function prepareV3CanarySources(
  input,
  canaryPets,
  readFailureReason = "asset_error",
) {
  const prepared = [];
  for (const pet of canaryPets) {
    const assetId = petAssetId(pet.spritesheetUrl);
    if (!assetId) throw new PetVisionBackfillError("asset_error");
    let extracted;
    try {
      const spritesheet = await input.readSpritesheet(assetId);
      extracted = await input.extractFrames(spritesheet);
    } catch {
      throw new PetVisionBackfillError(readFailureReason);
    }
    prepared.push({
      pet,
      assetId,
      extracted,
      captionSourceHash: createPetVisionCaptionSourceHash({
        captionRevision: PET_VISION_CAPTION_REVISION_V3,
        modelUri: input.config.modelUri,
        assetId,
        spritesheetSha256: extracted.spritesheetSha256,
      }),
    });
  }
  return prepared;
}

async function runV3CanaryBatch(input, canaryPets) {
  try {
    const prepared = await prepareV3CanarySources(input, canaryPets);
    const captionStages = [];
    for (const source of prepared) {
      let freshCaption = null;
      if (!input.options.force) {
        let storedCaption;
        try {
          storedCaption = await input.getCaption(
            PET_VISION_CAPTION_REVISION_V3,
            source.pet.slug,
          );
        } catch {
          throw new PetVisionBackfillError("persistence_error");
        }
        freshCaption = readFreshCaption({
          storedCaption,
          expectedSourceHash: source.captionSourceHash,
          captionRevision: PET_VISION_CAPTION_REVISION_V3,
          assetId: source.assetId,
          spritesheetSha256: source.extracted.spritesheetSha256,
        });
      }
      const caption = freshCaption
        ? freshCaption.caption
        : parsePetVisionCaption(
            PET_VISION_CAPTION_REVISION_V3,
            await callProvider(
              () => input.createCaption(source.extracted.frames),
            ),
          );
      const captionText = buildPetVisionCaptionText(
        PET_VISION_CAPTION_REVISION_V3,
        caption,
      );
      captionStages.push({
        ...source,
        caption,
        captionText,
        captionJson: JSON.stringify(
          createPetVisionCaptionEnvelope({
            captionRevision: PET_VISION_CAPTION_REVISION_V3,
            assetId: source.assetId,
            spritesheetSha256: source.extracted.spritesheetSha256,
            caption,
          }),
        ),
      });
    }

    for (const stage of captionStages) {
      const result = evaluatePetVisionV3Canary(
        stage.pet.slug,
        stage.caption,
      );
      input.log({ slug: stage.pet.slug, action: "canary", canary: result });
      if (!result?.passed) {
        throw new PetVisionBackfillError("canary_failed", result);
      }
    }

    const staged = [];
    for (const stage of captionStages) {
      const embedding = await callProvider(
        () => input.embedDocument(stage.captionText),
      );
      validateEmbedding(embedding, input.config.dimensions);
      staged.push({
        ...stage,
        embedding,
        visualSourceHash: createPetVisualEmbeddingSourceHash({
          visualRevision: PET_VISUAL_MODEL_REVISION_V3,
          captionRevision: PET_VISION_CAPTION_REVISION_V3,
          captionSourceHash: stage.captionSourceHash,
          captionText: stage.captionText,
        }),
      });
    }

    const currentApprovedPets = await listCurrentApprovedPets(input);
    const currentCanaryPets = selectV3CanaryPets(
      input,
      currentApprovedPets,
    );
    const currentSources = await prepareV3CanarySources(
      input,
      currentCanaryPets,
      "persistence_error",
    );
    const stagedBySlug = new Map(
      staged.map((stage) => [stage.pet.slug, stage]),
    );
    for (const current of currentSources) {
      const stage = stagedBySlug.get(current.pet.slug);
      if (
        stage?.pet.slug === current.pet.slug &&
        stage.assetId === current.assetId &&
        stage.extracted.spritesheetSha256 ===
          current.extracted.spritesheetSha256 &&
        stage.captionSourceHash === current.captionSourceHash
      ) {
        continue;
      }
      const result = {
        slug: current.pet.slug,
        passed: false,
        checks: [{ id: "source_unchanged", passed: false }],
      };
      input.log({
        slug: current.pet.slug,
        action: "canary",
        canary: result,
      });
      throw new PetVisionBackfillError("canary_failed", result);
    }

    const updatedAt = input.now().toISOString();
    for (const stage of staged) {
      try {
        await input.upsertCaption({
          captionRevision: PET_VISION_CAPTION_REVISION_V3,
          slug: stage.pet.slug,
          sourceHash: stage.captionSourceHash,
          captionJson: stage.captionJson,
          captionText: stage.captionText,
          updatedAt,
        });
        await input.upsertEmbedding({
          modelRevision: PET_VISUAL_MODEL_REVISION_V3,
          slug: stage.pet.slug,
          sourceHash: stage.visualSourceHash,
          dimensions: input.config.dimensions,
          embedding: stage.embedding,
          updatedAt,
        });
      } catch {
        throw new PetVisionBackfillError("persistence_error");
      }
    }

    const finalApprovedPets = await listCurrentApprovedPets(input);
    if (!(await isV3DurableGateOpen(input, finalApprovedPets))) {
      throw new PetVisionBackfillError("canary_failed", {
        slug: "v3-canary-gate",
        passed: false,
        checks: [{ id: "durable_gate", passed: false }],
      });
    }

    const summary = {
      scanned: staged.length,
      unchanged: 0,
      vectorOnly: 0,
      captionAndVector: staged.length,
    };
    for (const stage of staged) {
      input.log({ slug: stage.pet.slug, action: "caption-and-vector" });
    }
    input.log({ action: "summary", ...summary });
    return summary;
  } catch (error) {
    throw safeFailure(error);
  }
}

async function isV3DurableGateOpen(input, approvedPets) {
  const canaryPets = selectV3CanaryPets(input, approvedPets);
  const prepared = await prepareV3CanarySources(
    input,
    canaryPets,
    "persistence_error",
  );
  for (const source of prepared) {
    let storedCaption;
    let metadata;
    try {
      storedCaption = await input.getCaption(
        PET_VISION_CAPTION_REVISION_V3,
        source.pet.slug,
      );
    } catch {
      throw new PetVisionBackfillError("persistence_error");
    }
    const freshCaption = readFreshCaption({
      storedCaption,
      expectedSourceHash: source.captionSourceHash,
      captionRevision: PET_VISION_CAPTION_REVISION_V3,
      assetId: source.assetId,
      spritesheetSha256: source.extracted.spritesheetSha256,
    });
    if (
      !freshCaption ||
      !evaluatePetVisionV3Canary(
        source.pet.slug,
        freshCaption.caption,
      )?.passed
    ) {
      return false;
    }
    const visualSourceHash = createPetVisualEmbeddingSourceHash({
      visualRevision: PET_VISUAL_MODEL_REVISION_V3,
      captionRevision: PET_VISION_CAPTION_REVISION_V3,
      captionSourceHash: source.captionSourceHash,
      captionText: freshCaption.captionText,
    });
    try {
      metadata = await input.getEmbeddingMetadata(
        PET_VISUAL_MODEL_REVISION_V3,
        source.pet.slug,
      );
    } catch {
      throw new PetVisionBackfillError("persistence_error");
    }
    if (
      metadata?.sourceHash !== visualSourceHash ||
      metadata.dimensions !== input.config.dimensions
    ) {
      return false;
    }
  }
  return true;
}

async function listCurrentApprovedPets(input) {
  try {
    const pets = await input.listApprovedPets();
    return pets.filter(
      (candidate) =>
        !candidate.status || candidate.status === "approved",
    );
  } catch {
    throw new PetVisionBackfillError("persistence_error");
  }
}

async function processPet(input, pet) {
  const assetId = petAssetId(pet.spritesheetUrl);
  if (!assetId) throw new PetVisionBackfillError("asset_error");

  let extracted;
  try {
    const spritesheet = await input.readSpritesheet(assetId);
    extracted = await input.extractFrames(spritesheet);
  } catch {
    throw new PetVisionBackfillError("asset_error");
  }

  const captionSourceHash = createPetVisionCaptionSourceHash({
    captionRevision: input.config.captionRevision,
    modelUri: input.config.modelUri,
    assetId,
    spritesheetSha256: extracted.spritesheetSha256,
  });
  let storedCaption = null;
  if (!input.options.force) {
    try {
      storedCaption = await input.getCaption(
        input.config.captionRevision,
        pet.slug,
      );
    } catch {
      throw new PetVisionBackfillError("persistence_error");
    }
  }
  const freshCaption = readFreshCaption({
    storedCaption,
    expectedSourceHash: captionSourceHash,
    captionRevision: input.config.captionRevision,
    assetId,
    spritesheetSha256: extracted.spritesheetSha256,
  });

  if (freshCaption) {
    assertV2Canary(input, pet.slug, freshCaption.captionText);
    const visualSourceHash = createPetVisualEmbeddingSourceHash({
      visualRevision: input.config.visualRevision,
      captionRevision: input.config.captionRevision,
      captionSourceHash,
      captionText: freshCaption.captionText,
    });
    let metadata;
    try {
      metadata = await input.getEmbeddingMetadata(
        input.config.visualRevision,
        pet.slug,
      );
    } catch {
      throw new PetVisionBackfillError("persistence_error");
    }
    if (
      metadata?.sourceHash === visualSourceHash &&
      metadata.dimensions === input.config.dimensions
    ) {
      return "unchanged";
    }
    if (input.options.mode === "dry-run") return "vector-only";

    const embedding = await callProvider(
      () => input.embedDocument(freshCaption.captionText),
    );
    validateEmbedding(embedding, input.config.dimensions);
    try {
      await input.upsertEmbedding({
        modelRevision: input.config.visualRevision,
        slug: pet.slug,
        sourceHash: visualSourceHash,
        dimensions: input.config.dimensions,
        embedding,
        updatedAt: input.now().toISOString(),
      });
    } catch {
      throw new PetVisionBackfillError("persistence_error");
    }
    return "vector-only";
  }

  if (input.options.mode === "dry-run") return "caption-and-vector";

  const caption = await callProvider(
    () => input.createCaption(extracted.frames),
  );
  const captionText = buildPetVisionCaptionText(
    input.config.captionRevision,
    caption,
  );
  assertV2Canary(input, pet.slug, captionText);
  const captionJson = JSON.stringify(
    createPetVisionCaptionEnvelope({
      captionRevision: input.config.captionRevision,
      assetId,
      spritesheetSha256: extracted.spritesheetSha256,
      caption,
    }),
  );
  try {
    await input.upsertCaption({
      captionRevision: input.config.captionRevision,
      slug: pet.slug,
      sourceHash: captionSourceHash,
      captionJson,
      captionText,
      updatedAt: input.now().toISOString(),
    });
  } catch {
    throw new PetVisionBackfillError("persistence_error");
  }

  const embedding = await callProvider(
    () => input.embedDocument(captionText),
  );
  validateEmbedding(embedding, input.config.dimensions);
  try {
    await input.upsertEmbedding({
      modelRevision: input.config.visualRevision,
      slug: pet.slug,
      sourceHash: createPetVisualEmbeddingSourceHash({
        visualRevision: input.config.visualRevision,
        captionRevision: input.config.captionRevision,
        captionSourceHash,
        captionText,
      }),
      dimensions: input.config.dimensions,
      embedding,
      updatedAt: input.now().toISOString(),
    });
  } catch {
    throw new PetVisionBackfillError("persistence_error");
  }
  return "caption-and-vector";
}

function orderPetsForCanaryGate(input, selectedPets) {
  if (
    input.options.mode !== "apply" ||
    input.options.slug ||
    input.config.captionRevision !== PET_VISION_CAPTION_REVISION_V2
  ) {
    return selectedPets;
  }

  const petsBySlug = new Map(
    selectedPets.map((candidate) => [candidate.slug, candidate]),
  );
  for (const canary of PET_VISION_V2_CANARIES) {
    if (petsBySlug.has(canary.slug)) continue;
    const result = {
      slug: canary.slug,
      passed: false,
      checks: [{ id: "approved_pet_present", passed: false }],
    };
    input.log({
      slug: canary.slug,
      action: "canary",
      canary: result,
    });
    throw new PetVisionBackfillError("canary_failed", result);
  }

  const canarySlugs = new Set(
    PET_VISION_V2_CANARIES.map((canary) => canary.slug),
  );
  return [
    ...PET_VISION_V2_CANARIES.map(
      (canary) => petsBySlug.get(canary.slug),
    ),
    ...selectedPets.filter(
      (candidate) => !canarySlugs.has(candidate.slug),
    ),
  ];
}

function assertV2Canary(input, slug, captionText) {
  if (
    input.options.mode !== "apply" ||
    input.config.captionRevision !== PET_VISION_CAPTION_REVISION_V2
  ) {
    return;
  }
  const result = evaluatePetVisionCanary(slug, captionText);
  if (!result) return;
  input.log({ slug, action: "canary", canary: result });
  if (!result.passed) {
    throw new PetVisionBackfillError("canary_failed", result);
  }
}

async function callProvider(callback) {
  try {
    return await callback();
  } catch (error) {
    throw safeFailure(error);
  }
}

function safeFailure(error) {
  if (error instanceof PetVisionBackfillError) return error;
  const reason =
    error && typeof error === "object" && "reason" in error
      ? error.reason
      : null;
  return new PetVisionBackfillError(
    typeof reason === "string" && SAFE_FAILURE_REASONS.has(reason)
      ? reason
      : "provider_error",
  );
}

function readFreshCaption(input) {
  if (input.storedCaption?.sourceHash !== input.expectedSourceHash) {
    return null;
  }
  try {
    const envelope = parsePetVisionCaptionEnvelope(
      input.captionRevision,
      input.storedCaption.captionJson,
    );
    const captionText = buildPetVisionCaptionText(
      input.captionRevision,
      envelope.caption,
    );
    if (
      envelope.source.assetId !== input.assetId ||
      envelope.source.spritesheetSha256 !== input.spritesheetSha256 ||
      captionText !== input.storedCaption.captionText
    ) {
      return null;
    }
    return { captionText, caption: envelope.caption };
  } catch {
    return null;
  }
}

function validateEmbedding(embedding, dimensions) {
  if (
    !Array.isArray(embedding) ||
    embedding.length !== dimensions ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new PetVisionBackfillError("embedding_error");
  }
}

function petAssetId(value) {
  let pathname = value;
  if (value.startsWith("http://") || value.startsWith("https://")) {
    try {
      pathname = new URL(value).pathname;
    } catch {
      return null;
    }
  }
  const match = pathname.match(
    /\/api\/assets\/([^/]+)\/spritesheet\.(?:webp|png)$/,
  );
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function parseEnvelopeValue(revision, input) {
  const contract = getCaptionContract(revision);
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
  return {
    schemaVersion: contract.schemaVersion,
    source: { assetId, spritesheetSha256 },
    caption: parsePetVisionCaption(revision, envelope.caption),
  };
}

function getCaptionContract(revision) {
  const contract = PET_VISION_CAPTION_CONTRACTS[revision];
  if (!contract) {
    throw new Error("Unsupported pet vision caption revision.");
  }
  return contract;
}

function assertCaptionRevision(value) {
  if (
    typeof value !== "string" ||
    !PET_VISION_CAPTION_CONTRACTS[value]
  ) {
    throw new Error("Unsupported pet vision caption revision.");
  }
  return value;
}

function containsCanaryTerm(caption, term) {
  if (!term) return false;
  if (term.includes(" ")) return caption.includes(term);
  return caption.split(" ").includes(term);
}

function normalizeCanaryText(value) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("und")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function visualAttributeV3(input, path) {
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

function bilingualText(input, path, maxLength, required) {
  const value = strictObject(input, path, ["en", "ru"]);
  return {
    en: normalizedString(value.en, `${path}.en`, required ? 1 : 0, maxLength),
    ru: normalizedString(value.ru, `${path}.ru`, required ? 1 : 0, maxLength),
  };
}

function stringList(input, path, minItems, maxItems, maxLength) {
  if (!Array.isArray(input)) {
    throw new Error(`${path} must be an array.`);
  }
  if (input.length > maxItems) {
    throw new Error(`${path} must contain at most ${maxItems} items.`);
  }
  const seen = new Set();
  const values = [];
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

function normalizedString(input, path, minLength, maxLength) {
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

function strictObject(input, path, fields) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${path} must be an object.`);
  }
  const allowed = new Set(fields);
  const unknownField = Object.keys(input).find((key) => !allowed.has(key));
  if (unknownField) {
    throw new Error(`${path} contains unknown field ${unknownField}.`);
  }
  const missingField = fields.find(
    (field) => !Object.prototype.hasOwnProperty.call(input, field),
  );
  if (missingField) {
    throw new Error(`${path} is missing field ${missingField}.`);
  }
  return input;
}

function lengthPrefixedSha256(parts) {
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
