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
    expect(v2CaptionHash).not.toBe(captionHash);
    expect(v2VisualHash).not.toBe(visualHash);
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
