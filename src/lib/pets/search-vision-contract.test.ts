import { describe, expect, it } from "vitest";

import {
  PET_DERIVED_VISION_CAPTION_REVISION,
  PET_VISION_CAPTION_REVISION,
  PET_VISUAL_MODEL_REVISION,
  buildPetVisionCaptionText,
  createPetDerivedVisionCaptionEnvelope,
  createPetDerivedVisionCaptionSourceHash,
  createPetDerivedVisionCaptionSourceHashFromTextHash,
  createPetVisionCaptionTextHash,
  createPetVisionCaptionEnvelope,
  createPetVisionCaptionSourceHash,
  createPetVisualEmbeddingSourceHash,
  parsePetDerivedVisionCaptionEnvelope,
  parsePetVisionCaption,
  parsePetVisionCaptionEnvelope,
} from "@/lib/pets/search-vision-contract";

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

describe("pet vision caption contract", () => {
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

  it("stores strict derived-caption provenance and invalidates every upstream input", () => {
    const caption = parsePetVisionCaption(rawCaption);
    const upstreamCaptionText = buildPetVisionCaptionText(caption);
    const upstreamCaptionTextSha256 =
      createPetVisionCaptionTextHash(upstreamCaptionText);
    const sourceInput = {
      captionRevision: PET_DERIVED_VISION_CAPTION_REVISION,
      modelUri: "gpt://folder-1/deepseek-v4-flash",
      upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
      upstreamSourceHash: "a".repeat(64),
      upstreamCaptionText,
    };
    const sourceHash = createPetDerivedVisionCaptionSourceHash(sourceInput);
    const envelope = createPetDerivedVisionCaptionEnvelope({
      upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
      upstreamSourceHash: sourceInput.upstreamSourceHash,
      upstreamCaptionTextSha256,
      caption,
    });

    expect(
      parsePetDerivedVisionCaptionEnvelope(JSON.stringify(envelope)),
    ).toEqual(envelope);
    expect(envelope).toMatchObject({
      schemaVersion: 2,
      source: {
        upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
        upstreamSourceHash: "a".repeat(64),
        upstreamCaptionTextSha256,
      },
    });
    expect(
      createPetDerivedVisionCaptionSourceHashFromTextHash({
        captionRevision: sourceInput.captionRevision,
        modelUri: sourceInput.modelUri,
        upstreamCaptionRevision: sourceInput.upstreamCaptionRevision,
        upstreamSourceHash: sourceInput.upstreamSourceHash,
        upstreamCaptionTextSha256,
      }),
    ).toBe(sourceHash);
    expect(
      createPetDerivedVisionCaptionSourceHash({
        ...sourceInput,
        modelUri: "gpt://folder-1/deepseek-v4-flash-changed",
      }),
    ).not.toBe(sourceHash);
    expect(
      createPetDerivedVisionCaptionSourceHash({
        ...sourceInput,
        upstreamSourceHash: "b".repeat(64),
      }),
    ).not.toBe(sourceHash);
    expect(
      createPetDerivedVisionCaptionSourceHash({
        ...sourceInput,
        upstreamCaptionText: `${upstreamCaptionText}\nchanged`,
      }),
    ).not.toBe(sourceHash);
  });

  it("rejects incomplete or non-hash derived provenance", () => {
    const caption = parsePetVisionCaption(rawCaption);
    const envelope = createPetDerivedVisionCaptionEnvelope({
      upstreamCaptionRevision: PET_VISION_CAPTION_REVISION,
      upstreamSourceHash: "a".repeat(64),
      upstreamCaptionTextSha256: "b".repeat(64),
      caption,
    });

    expect(() =>
      parsePetDerivedVisionCaptionEnvelope(
        JSON.stringify({
          ...envelope,
          source: {
            ...envelope.source,
            upstreamCaptionTextSha256: "not-a-hash",
          },
        }),
      ),
    ).toThrow(/upstreamCaptionTextSha256/i);
    expect(() =>
      parsePetDerivedVisionCaptionEnvelope(
        JSON.stringify({
          ...envelope,
          source: {
            ...envelope.source,
            catalogSlug: "must-not-exist",
          },
        }),
      ),
    ).toThrow(/unknown field/i);
  });
});
