import { describe, expect, it } from "vitest";

import * as visionContract from "@/lib/pets/search-vision-contract";
import {
  PET_VISION_CAPTION_REVISION,
  PET_VISUAL_MODEL_REVISION,
  buildPetVisionCaptionText,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  parsePetVisionCaption,
  parsePetVisionCaptionEnvelope,
} from "@/lib/pets/search-vision-contract";

const v2CaptionRevision =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v2";
const v2VisualRevision = "yandex-text-search-2026-07-pet-vision-v2";
const v3CaptionRevision =
  "yandex-qwen3.6-35b-a3b-pet-caption-2026-07-v3";
const v3VisualRevision = "yandex-text-search-2026-07-pet-vision-v3";
const v3AttributeSlots = [
  "hair_and_headwear",
  "face_and_eye_coverings",
  "clothing_and_armor",
  "weapons_and_objects",
  "visible_effects",
  "other_distinguishing_features",
] as const;

const rawCaption = {
  subject: { en: "  Ｇｉｒｌ  ", ru: "  девушка " },
  appearance: {
    en: " Long   silver hair ",
    ru: " Длинные   серебряные волосы ",
  },
  clothing: { en: " Black dress ", ru: " Чёрное платье " },
  style: { en: " Pixel art ", ru: " Пиксель-арт " },
  mood: { en: " Confident pose ", ru: " Уверенная поза " },
  colors: {
    en: ["Black", " black ", "PURPLE"],
    ru: ["чёрный", " ЧЁРНЫЙ ", "фиолетовый"],
  },
  search_terms_en: ["anime woman", " ANIME WOMAN ", "gothic", "elegant"],
  search_terms_ru: ["аниме девушка", " АНИМЕ ДЕВУШКА ", "готика", "элегантная"],
};

const rawV2Caption = {
  ...rawCaption,
  accessories: {
    en: " Black blindfold and sword ",
    ru: " Чёрная повязка и меч ",
  },
};

const rawV3Caption = {
  subject: rawCaption.subject,
  appearance: rawCaption.appearance,
  visual_attributes: {
    hair_and_headwear: {
      present: true,
      en: " Long   silver hair ",
      ru: " Длинные   серебряные волосы ",
    },
    face_and_eye_coverings: {
      present: true,
      en: " Black   blindfold ",
      ru: " Чёрная   повязка ",
    },
    clothing_and_armor: {
      present: true,
      en: " Black dress ",
      ru: " Чёрное платье ",
    },
    weapons_and_objects: { present: false, en: " \t ", ru: " " },
    visible_effects: { present: false, en: "", ru: "" },
    other_distinguishing_features: {
      present: false,
      en: "",
      ru: "",
    },
  },
  style: rawCaption.style,
  mood: rawCaption.mood,
  colors: rawCaption.colors,
  search_terms_en: rawCaption.search_terms_en,
  search_terms_ru: rawCaption.search_terms_ru,
};

describe("pet vision caption contract", () => {
  it("registers immutable v1 and v2 caption contracts", () => {
    const getContract = (
      visionContract as unknown as {
        getPetVisionCaptionContract?: (revision: string) => {
          schemaVersion: number;
          responseSchemaName: string;
        };
      }
    ).getPetVisionCaptionContract;

    expect(getContract).toBeTypeOf("function");
    expect(getContract?.(PET_VISION_CAPTION_REVISION)).toMatchObject({
      schemaVersion: 1,
      responseSchemaName: "pet_visual_caption_v1",
    });
    expect(getContract?.(v2CaptionRevision)).toMatchObject({
      schemaVersion: 2,
      responseSchemaName: "pet_visual_caption_v2",
    });
  });

  it("registers immutable max-token limits and the strict v3 provider schema", () => {
    const getContract = visionContract.getPetVisionCaptionContract as (
      revision: string,
    ) => {
      maxTokens: number;
      modelName: string;
      schemaVersion: number;
      responseSchemaName: string;
      responseJsonSchema: {
        required: readonly string[];
        properties: {
          visual_attributes: {
            required: readonly string[];
            properties: Record<string, { $ref: string }>;
          };
        };
        $defs: {
          visualAttribute: {
            type: string;
            additionalProperties: boolean;
            required: readonly string[];
            properties: {
              present: { type: string };
              en: { type: string; maxLength: number };
              ru: { type: string; maxLength: number };
            };
          };
        };
      };
    };

    expect(getContract(PET_VISION_CAPTION_REVISION).maxTokens).toBe(900);
    expect(getContract(v2CaptionRevision).maxTokens).toBe(900);
    const contract = getContract(v3CaptionRevision);
    expect(contract).toMatchObject({
      modelName: "qwen3.6-35b-a3b",
      schemaVersion: 3,
      responseSchemaName: "pet_visual_caption_v3",
      maxTokens: 1200,
    });
    expect(contract.responseJsonSchema.required).toEqual([
      "subject",
      "appearance",
      "visual_attributes",
      "style",
      "mood",
      "colors",
      "search_terms_en",
      "search_terms_ru",
    ]);
    expect(contract.responseJsonSchema.properties.visual_attributes.required)
      .toEqual(v3AttributeSlots);
    expect(
      contract.responseJsonSchema.properties.visual_attributes.properties,
    ).toEqual(
      Object.fromEntries(
        v3AttributeSlots.map((slot) => [
          slot,
          { $ref: "#/$defs/visualAttribute" },
        ]),
      ),
    );
    expect(contract.responseJsonSchema.$defs.visualAttribute).toEqual({
      type: "object",
      additionalProperties: false,
      required: ["present", "en", "ru"],
      properties: {
        present: { type: "boolean" },
        en: { type: "string", maxLength: 240 },
        ru: { type: "string", maxLength: 240 },
      },
    });
  });

  it("strictly normalizes the bilingual provider response", () => {
    expect(parsePetVisionCaption(rawCaption)).toEqual({
      subject: { en: "Girl", ru: "девушка" },
      appearance: {
        en: "Long silver hair",
        ru: "Длинные серебряные волосы",
      },
      clothing: { en: "Black dress", ru: "Чёрное платье" },
      style: { en: "Pixel art", ru: "Пиксель-арт" },
      mood: { en: "Confident pose", ru: "Уверенная поза" },
      colors: {
        en: ["Black", "PURPLE"],
        ru: ["чёрный", "фиолетовый"],
      },
      search_terms_en: ["anime woman", "gothic", "elegant"],
      search_terms_ru: ["аниме девушка", "готика", "элегантная"],
    });
  });

  it("rejects unknown, missing, oversized, and wrongly typed values", () => {
    expect(() =>
      parsePetVisionCaption({ ...rawCaption, identity: "forbidden" }),
    ).toThrow(/unknown field/i);
    const missingMood: Partial<typeof rawCaption> = { ...rawCaption };
    delete missingMood.mood;
    expect(() => parsePetVisionCaption(missingMood)).toThrow(/missing field/i);
    expect(() =>
      parsePetVisionCaption({
        ...rawCaption,
        subject: { ...rawCaption.subject, en: "x".repeat(321) },
      }),
    ).toThrow(/subject\.en/i);
    expect(() =>
      parsePetVisionCaption({
        ...rawCaption,
        colors: { ...rawCaption.colors, en: "black" },
      }),
    ).toThrow(/colors\.en/i);
  });

  it("builds the caption text in the frozen field order", () => {
    const caption = parsePetVisionCaption(rawCaption);
    expect(buildPetVisionCaptionText(caption)).toBe(
      [
        "subject_en: Girl",
        "subject_ru: девушка",
        "appearance_en: Long silver hair",
        "appearance_ru: Длинные серебряные волосы",
        "clothing_en: Black dress",
        "clothing_ru: Чёрное платье",
        "style_en: Pixel art",
        "style_ru: Пиксель-арт",
        "mood_en: Confident pose",
        "mood_ru: Уверенная поза",
        "colors_en: Black, PURPLE",
        "colors_ru: чёрный, фиолетовый",
        "search_terms_en: anime woman, gothic, elegant",
        "search_terms_ru: аниме девушка, готика, элегантная",
      ].join("\n"),
    );
  });

  it("requires v2 accessories and places them in canonical field order", () => {
    const parseV2 = parsePetVisionCaption as unknown as (
      revision: string,
      value: unknown,
    ) => typeof rawV2Caption;
    const buildV2 = buildPetVisionCaptionText as unknown as (
      revision: string,
      caption: typeof rawV2Caption,
    ) => string;

    expect(() => parseV2(v2CaptionRevision, rawCaption)).toThrow(
      /missing field accessories/i,
    );
    const withEmptyAccessories = parseV2(v2CaptionRevision, {
      ...rawCaption,
      accessories: { en: "", ru: "" },
    });
    expect(withEmptyAccessories.accessories).toEqual({ en: "", ru: "" });

    const captionText = buildV2(
      v2CaptionRevision,
      parseV2(v2CaptionRevision, rawV2Caption),
    );
    expect(captionText).toContain(
      [
        "clothing_ru: Чёрное платье",
        "accessories_en: Black blindfold and sword",
        "accessories_ru: Чёрная повязка и меч",
        "style_en: Pixel art",
      ].join("\n"),
    );
  });

  it("strictly normalizes presence-aware v3 visual attributes", () => {
    const parseV3 = parsePetVisionCaption as unknown as (
      revision: string,
      value: unknown,
    ) => typeof rawV3Caption;

    expect(parseV3(v3CaptionRevision, rawV3Caption)).toMatchObject({
      visual_attributes: {
        hair_and_headwear: {
          present: true,
          en: "Long silver hair",
          ru: "Длинные серебряные волосы",
        },
        face_and_eye_coverings: {
          present: true,
          en: "Black blindfold",
          ru: "Чёрная повязка",
        },
        weapons_and_objects: { present: false, en: "", ru: "" },
      },
    });
  });

  it.each([
    [
      "unknown top-level field",
      { ...rawV3Caption, identity: "forbidden" },
      /unknown field identity/i,
    ],
    [
      "missing slot",
      {
        ...rawV3Caption,
        visual_attributes: Object.fromEntries(
          Object.entries(rawV3Caption.visual_attributes).filter(
            ([slot]) => slot !== "visible_effects",
          ),
        ),
      },
      /missing field visible_effects/i,
    ],
    [
      "unknown slot field",
      {
        ...rawV3Caption,
        visual_attributes: {
          ...rawV3Caption.visual_attributes,
          visible_effects: {
            ...rawV3Caption.visual_attributes.visible_effects,
            confidence: 1,
          },
        },
      },
      /unknown field confidence/i,
    ],
    [
      "non-boolean presence",
      {
        ...rawV3Caption,
        visual_attributes: {
          ...rawV3Caption.visual_attributes,
          visible_effects: { present: "false", en: "", ru: "" },
        },
      },
      /present must be a boolean/i,
    ],
    [
      "present without English",
      {
        ...rawV3Caption,
        visual_attributes: {
          ...rawV3Caption.visual_attributes,
          visible_effects: { present: true, en: " ", ru: "огонь" },
        },
      },
      /present attributes require non-empty en and ru/i,
    ],
    [
      "present without Russian",
      {
        ...rawV3Caption,
        visual_attributes: {
          ...rawV3Caption.visual_attributes,
          visible_effects: { present: true, en: "fire", ru: " " },
        },
      },
      /present attributes require non-empty en and ru/i,
    ],
    [
      "absent with English",
      {
        ...rawV3Caption,
        visual_attributes: {
          ...rawV3Caption.visual_attributes,
          visible_effects: { present: false, en: "fire", ru: "" },
        },
      },
      /absent attributes require empty en and ru/i,
    ],
    [
      "absent with Russian",
      {
        ...rawV3Caption,
        visual_attributes: {
          ...rawV3Caption.visual_attributes,
          visible_effects: { present: false, en: "", ru: "огонь" },
        },
      },
      /absent attributes require empty en and ru/i,
    ],
    [
      "oversized slot text",
      {
        ...rawV3Caption,
        visual_attributes: {
          ...rawV3Caption.visual_attributes,
          visible_effects: {
            present: true,
            en: "x".repeat(241),
            ru: "огонь",
          },
        },
      },
      /visual_attributes\.visible_effects\.en/i,
    ],
  ])("rejects v3 %s", (_name, value, expectedError) => {
    const parseV3 = parsePetVisionCaption as unknown as (
      revision: string,
      value: unknown,
    ) => unknown;
    expect(() => parseV3(v3CaptionRevision, value)).toThrow(expectedError);
  });

  it("builds v3 canonical text with frozen empty slot lines and no booleans", () => {
    const parseV3 = parsePetVisionCaption as unknown as (
      revision: string,
      value: unknown,
    ) => typeof rawV3Caption;
    const buildV3 = buildPetVisionCaptionText as unknown as (
      revision: string,
      caption: typeof rawV3Caption,
    ) => string;

    const captionText = buildV3(
      v3CaptionRevision,
      parseV3(v3CaptionRevision, rawV3Caption),
    );
    expect(captionText).toBe(
      [
        "subject_en: Girl",
        "subject_ru: девушка",
        "appearance_en: Long silver hair",
        "appearance_ru: Длинные серебряные волосы",
        "hair_and_headwear_en: Long silver hair",
        "hair_and_headwear_ru: Длинные серебряные волосы",
        "face_and_eye_coverings_en: Black blindfold",
        "face_and_eye_coverings_ru: Чёрная повязка",
        "clothing_and_armor_en: Black dress",
        "clothing_and_armor_ru: Чёрное платье",
        "weapons_and_objects_en: ",
        "weapons_and_objects_ru: ",
        "visible_effects_en: ",
        "visible_effects_ru: ",
        "other_distinguishing_features_en: ",
        "other_distinguishing_features_ru: ",
        "style_en: Pixel art",
        "style_ru: Пиксель-арт",
        "mood_en: Confident pose",
        "mood_ru: Уверенная поза",
        "colors_en: Black, PURPLE",
        "colors_ru: чёрный, фиолетовый",
        "search_terms_en: anime woman, gothic, elegant",
        "search_terms_ru: аниме девушка, готика, элегантная",
      ].join("\n"),
    );
    expect(captionText).not.toMatch(/_present:|\btrue\b|\bfalse\b/);
  });

  it("round-trips the revision-bound v2 envelope", () => {
    const parseV2 = parsePetVisionCaption as unknown as (
      revision: string,
      value: unknown,
    ) => typeof rawV2Caption;
    const createEnvelope = createPetVisionCaptionEnvelope as unknown as (
      input: {
        captionRevision: string;
        assetId: string;
        spritesheetSha256: string;
        caption: typeof rawV2Caption;
      },
    ) => { schemaVersion: number };
    const parseEnvelope = parsePetVisionCaptionEnvelope as unknown as (
      revision: string,
      value: string,
    ) => { schemaVersion: number };
    const envelope = createEnvelope({
      captionRevision: v2CaptionRevision,
      assetId: "asset-123",
      spritesheetSha256: "a".repeat(64),
      caption: parseV2(v2CaptionRevision, rawV2Caption),
    });

    expect(envelope.schemaVersion).toBe(2);
    expect(
      parseEnvelope(v2CaptionRevision, JSON.stringify(envelope)),
    ).toEqual(envelope);
    expect(() =>
      parseEnvelope(PET_VISION_CAPTION_REVISION, JSON.stringify(envelope)),
    ).toThrow(/schemaVersion must be 1/i);
  });

  it("round-trips the revision-bound v3 envelope", () => {
    const parseV3 = parsePetVisionCaption as unknown as (
      revision: string,
      value: unknown,
    ) => typeof rawV3Caption;
    const createEnvelope = createPetVisionCaptionEnvelope as unknown as (
      input: {
        captionRevision: string;
        assetId: string;
        spritesheetSha256: string;
        caption: typeof rawV3Caption;
      },
    ) => { schemaVersion: number };
    const parseEnvelope = parsePetVisionCaptionEnvelope as unknown as (
      revision: string,
      value: string,
    ) => { schemaVersion: number };
    const envelope = createEnvelope({
      captionRevision: v3CaptionRevision,
      assetId: "asset-123",
      spritesheetSha256: "a".repeat(64),
      caption: parseV3(v3CaptionRevision, rawV3Caption),
    });

    expect(envelope.schemaVersion).toBe(3);
    expect(
      parseEnvelope(v3CaptionRevision, JSON.stringify(envelope)),
    ).toEqual(envelope);
    expect(() =>
      parseEnvelope(v2CaptionRevision, JSON.stringify(envelope)),
    ).toThrow(/schemaVersion must be 2/i);
  });

  it("round-trips a strict internal provenance envelope", () => {
    const caption = parsePetVisionCaption(rawCaption);
    const envelope = createPetVisionCaptionEnvelope({
      assetId: "asset-123",
      spritesheetSha256: "a".repeat(64),
      caption,
    });

    expect(
      parsePetVisionCaptionEnvelope(JSON.stringify(envelope)),
    ).toEqual(envelope);
    expect(() =>
      parsePetVisionCaptionEnvelope(
        JSON.stringify({ ...envelope, publicName: "must not exist" }),
      ),
    ).toThrow(/unknown field/i);
  });

  it("uses revision-bound unambiguous caption and visual hashes", () => {
    const caption = parsePetVisionCaption(rawCaption);
    const captionText = buildPetVisionCaptionText(caption);
    const captionHash = createPetVisionCaptionSourceHash({
      captionRevision: PET_VISION_CAPTION_REVISION,
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      assetId: "asset-123",
      spritesheetSha256: "a".repeat(64),
    });
    const visualHash = createPetVisualEmbeddingSourceHash({
      visualRevision: PET_VISUAL_MODEL_REVISION,
      captionRevision: PET_VISION_CAPTION_REVISION,
      captionSourceHash: captionHash,
      captionText,
    });

    expect(captionHash).toBe(
      "72ecb84c11425f2f75369bc5d095f869ec09de43802868181ed9349d9edd2af0",
    );
    expect(visualHash).toBe(
      "67c3b41b5a495160b93c10c240a67bbe620fc307138481a775ba7a34f8c9d0a0",
    );
    const createCaptionHash = createPetVisionCaptionSourceHash as unknown as (
      input: {
        captionRevision: string;
        modelUri: string;
        assetId: string;
        spritesheetSha256: string;
      },
    ) => string;
    const v2CaptionHash = createCaptionHash({
      captionRevision: v2CaptionRevision,
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      assetId: "asset-123",
      spritesheetSha256: "a".repeat(64),
    });
    const parseV2 = parsePetVisionCaption as unknown as (
      revision: string,
      value: unknown,
    ) => typeof rawV2Caption;
    const buildV2 = buildPetVisionCaptionText as unknown as (
      revision: string,
      caption: typeof rawV2Caption,
    ) => string;
    const v2VisualHash = createPetVisualEmbeddingSourceHash({
      visualRevision: v2VisualRevision,
      captionRevision: v2CaptionRevision,
      captionSourceHash: v2CaptionHash,
      captionText: buildV2(
        v2CaptionRevision,
        parseV2(v2CaptionRevision, rawV2Caption),
      ),
    });
    const v3CaptionHash = createCaptionHash({
      captionRevision: v3CaptionRevision,
      modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
      assetId: "asset-123",
      spritesheetSha256: "a".repeat(64),
    });
    const parseV3 = parsePetVisionCaption as unknown as (
      revision: string,
      value: unknown,
    ) => typeof rawV3Caption;
    const buildV3 = buildPetVisionCaptionText as unknown as (
      revision: string,
      caption: typeof rawV3Caption,
    ) => string;
    const v3VisualHash = createPetVisualEmbeddingSourceHash({
      visualRevision: v3VisualRevision,
      captionRevision: v3CaptionRevision,
      captionSourceHash: v3CaptionHash,
      captionText: buildV3(
        v3CaptionRevision,
        parseV3(v3CaptionRevision, rawV3Caption),
      ),
    });
    expect({
      v2CaptionHash,
      v2VisualHash,
      v3CaptionHash,
      v3VisualHash,
    }).toEqual({
      v2CaptionHash:
        "9e1072824c087ca7f07311fee81b084c68f21f18d58063d00a1767dd30d25b42",
      v2VisualHash:
        "52e9e319a4b2027af327a79c120775d439be6e340b3134d73d18ce4d092eb72e",
      v3CaptionHash:
        "ab6c12725a765aeba40b80f70e0e02d6b2b1059ed6a6a148c95030b76f3c2971",
      v3VisualHash:
        "4cefa494d67ba7d45db534dad6986a7d6d14152aa4bd132bb976bea5547d6d83",
    });
    expect(v3CaptionHash).not.toBe(v2CaptionHash);
    expect(v3VisualHash).not.toBe(v2VisualHash);
    expect(
      createPetVisionCaptionSourceHash({
        captionRevision: PET_VISION_CAPTION_REVISION,
        modelUri: "gpt://folder-1/qwen3.6-35b-a3b",
        assetId: "asset-124",
        spritesheetSha256: "a".repeat(64),
      }),
    ).not.toBe(captionHash);
    expect(
      createPetVisualEmbeddingSourceHash({
        visualRevision: `${PET_VISUAL_MODEL_REVISION}-changed`,
        captionRevision: PET_VISION_CAPTION_REVISION,
        captionSourceHash: captionHash,
        captionText,
      }),
    ).not.toBe(visualHash);
  });
});
