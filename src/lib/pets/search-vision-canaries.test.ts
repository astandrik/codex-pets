import { describe, expect, it } from "vitest";

import {
  PET_VISION_V2_CANARIES,
  evaluatePetVisionCanary,
} from "@/lib/pets/search-vision-canaries";
import * as visionCanaries from "@/lib/pets/search-vision-canaries";
import type { PetVisionCaptionV3 } from "@/lib/pets/search-vision-contract";

const baseV3Caption: PetVisionCaptionV3 = {
  subject: { en: "animated companion", ru: "анимированный спутник" },
  appearance: { en: "detailed sprite", ru: "детализированный спрайт" },
  visual_attributes: {
    hair_and_headwear: { present: false, en: "", ru: "" },
    face_and_eye_coverings: { present: false, en: "", ru: "" },
    clothing_and_armor: { present: false, en: "", ru: "" },
    weapons_and_objects: { present: false, en: "", ru: "" },
    visible_effects: { present: false, en: "", ru: "" },
    other_distinguishing_features: { present: false, en: "", ru: "" },
  },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "confident", ru: "уверенный" },
  colors: { en: ["black"], ru: ["чёрный"] },
  search_terms_en: ["animated pet", "pixel companion", "sprite art"],
  search_terms_ru: ["анимированный питомец", "пиксельный спутник", "спрайт"],
};

type EvaluateV3Canary = (
  slug: string,
  caption: PetVisionCaptionV3,
) => {
  slug: string;
  passed: boolean;
  checks: Array<{ id: string; passed: boolean }>;
} | null;

function v3Evaluator(): EvaluateV3Canary | undefined {
  return (
    visionCanaries as unknown as {
      evaluatePetVisionV3Canary?: EvaluateV3Canary;
    }
  ).evaluatePetVisionV3Canary;
}

describe("pet vision caption canaries", () => {
  it("freezes the four approved attribute canaries", () => {
    expect(PET_VISION_V2_CANARIES.map((canary) => canary.slug)).toEqual([
      "fischl-detailed",
      "2b-2",
      "master-of-terra",
      "vi",
    ]);
  });

  it("matches normalized English and Russian concept alternatives", () => {
    expect(
      evaluatePetVisionCanary(
        "fischl-detailed",
        [
          "appearance_en: ＢＬＯＮＤＥ   HAIR and one eye covered",
          "clothing_ru: Фиолетовый наряд и чёрная одежда",
        ].join("\n"),
      ),
    ).toEqual({
      slug: "fischl-detailed",
      passed: true,
      checks: [
        { id: "blonde_hair", passed: true },
        { id: "dark_eye_covering", passed: true },
        { id: "purple_outfit", passed: true },
        { id: "dark_outfit", passed: true },
      ],
    });
  });

  it("returns only sanitized booleans when a visible concept is absent", () => {
    const captionText = [
      "appearance_en: blonde hair",
      "clothing_en: purple outfit and black clothing",
    ].join("\n");
    const result = evaluatePetVisionCanary(
      "fischl-detailed",
      captionText,
    );

    expect(result).toEqual({
      slug: "fischl-detailed",
      passed: false,
      checks: [
        { id: "blonde_hair", passed: true },
        { id: "dark_eye_covering", passed: false },
        { id: "purple_outfit", passed: true },
        { id: "dark_outfit", passed: true },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("blonde hair");
    expect(JSON.stringify(result)).not.toContain("expectedAnyTerms");
  });

  it("covers the remaining frozen bilingual attributes", () => {
    expect(
      evaluatePetVisionCanary(
        "2b-2",
        "серебряные волосы, чёрная повязка на глаз, чёрное платье, меч",
      )?.passed,
    ).toBe(true);
    expect(
      evaluatePetVisionCanary(
        "master-of-terra",
        "golden armor, red cloak, flaming sword",
      )?.passed,
    ).toBe(true);
    expect(
      evaluatePetVisionCanary(
        "vi",
        "magenta hair and oversized mechanical gauntlets",
      )?.passed,
    ).toBe(true);
    expect(evaluatePetVisionCanary("velvet-byte", "anything")).toBeNull();
  });

  it("freezes a separate slot-aware v3 registry in approved order", () => {
    const registry = (
      visionCanaries as unknown as {
        PET_VISION_V3_CANARIES?: ReadonlyArray<{
          slug: string;
          expectations: ReadonlyArray<{
            id: string;
            slot: string;
            expectedAnyTermsEn: readonly string[];
            expectedAnyTermsRu: readonly string[];
          }>;
        }>;
      }
    ).PET_VISION_V3_CANARIES;

    expect(registry).toBeDefined();
    expect(registry?.map((canary) => canary.slug)).toEqual([
      "fischl-detailed",
      "2b-2",
      "master-of-terra",
      "vi",
    ]);
    expect(
      registry?.find((canary) => canary.slug === "master-of-terra")
        ?.expectations.map(({ id, slot }) => ({ id, slot })),
    ).toEqual([
      { id: "golden_armor", slot: "clothing_and_armor" },
      { id: "red_cloak", slot: "clothing_and_armor" },
      { id: "sword", slot: "weapons_and_objects" },
      { id: "flame_effect", slot: "visible_effects" },
    ]);
  });

  it("isolates terms to the named slot and exact language", () => {
    const evaluate = v3Evaluator();
    expect(evaluate).toBeTypeOf("function");
    if (!evaluate) return;

    const wrongSlots: PetVisionCaptionV3 = {
      ...baseV3Caption,
      appearance: {
        en: "blonde hair with a black eye patch",
        ru: "светлые волосы и чёрная повязка на глаз",
      },
      visual_attributes: {
        ...baseV3Caption.visual_attributes,
        hair_and_headwear: {
          present: true,
          en: "black eye patch",
          ru: "чёрная повязка на глаз",
        },
        face_and_eye_coverings: {
          present: true,
          en: "blonde hair",
          ru: "светлые волосы",
        },
        clothing_and_armor: {
          present: true,
          en: "purple outfit and black clothing",
          ru: "фиолетовый наряд и чёрная одежда",
        },
      },
    };

    expect(evaluate("fischl-detailed", wrongSlots)).toEqual({
      slug: "fischl-detailed",
      passed: false,
      checks: [
        { id: "blonde_hair", passed: false },
        { id: "dark_eye_covering", passed: false },
        { id: "purple_outfit", passed: true },
        { id: "dark_outfit", passed: true },
      ],
    });
  });

  it("requires an exact frozen dark-eye concept, not a generic covering", () => {
    const evaluate = v3Evaluator();
    expect(evaluate).toBeTypeOf("function");
    if (!evaluate) return;

    const caption: PetVisionCaptionV3 = {
      ...baseV3Caption,
      visual_attributes: {
        ...baseV3Caption.visual_attributes,
        hair_and_headwear: {
          present: true,
          en: "blonde hair",
          ru: "светлые волосы",
        },
        face_and_eye_coverings: {
          present: true,
          en: "eye covering",
          ru: "повязка",
        },
        clothing_and_armor: {
          present: true,
          en: "purple outfit and black clothing",
          ru: "фиолетовый наряд и чёрная одежда",
        },
      },
    };

    expect(
      evaluate("fischl-detailed", caption)?.checks.find(
        ({ id }) => id === "dark_eye_covering",
      ),
    ).toEqual({ id: "dark_eye_covering", passed: false });
  });

  it("checks the Master sword and flame independently in their slots", () => {
    const evaluate = v3Evaluator();
    expect(evaluate).toBeTypeOf("function");
    if (!evaluate) return;

    const caption: PetVisionCaptionV3 = {
      ...baseV3Caption,
      visual_attributes: {
        ...baseV3Caption.visual_attributes,
        clothing_and_armor: {
          present: true,
          en: "golden armor and red cloak with a sword and flames",
          ru: "золотая броня и красный плащ с мечом и пламенем",
        },
        weapons_and_objects: {
          present: true,
          en: "ornate shield",
          ru: "украшенный щит",
        },
        visible_effects: {
          present: true,
          en: "glowing aura",
          ru: "светящаяся аура",
        },
      },
    };

    expect(evaluate("master-of-terra", caption)).toEqual({
      slug: "master-of-terra",
      passed: false,
      checks: [
        { id: "golden_armor", passed: true },
        { id: "red_cloak", passed: true },
        { id: "sword", passed: false },
        { id: "flame_effect", passed: false },
      ],
    });
  });

  it("fails absent slots and exposes only ids plus booleans", () => {
    const evaluate = v3Evaluator();
    expect(evaluate).toBeTypeOf("function");
    if (!evaluate) return;

    const caption: PetVisionCaptionV3 = {
      ...baseV3Caption,
      visual_attributes: {
        ...baseV3Caption.visual_attributes,
        hair_and_headwear: {
          present: false,
          en: "pink hair",
          ru: "розовые волосы",
        },
        weapons_and_objects: {
          present: true,
          en: "massive gauntlets",
          ru: "массивные перчатки",
        },
      },
    };
    const result = evaluate("vi", caption);

    expect(result).toEqual({
      slug: "vi",
      passed: false,
      checks: [
        { id: "magenta_hair", passed: false },
        { id: "oversized_gauntlets", passed: true },
      ],
    });
    expect(Object.keys(result ?? {})).toEqual(["slug", "passed", "checks"]);
    expect(JSON.stringify(result)).not.toMatch(
      /pink hair|розовые волосы|expectedAnyTerms|visual_attributes/,
    );
  });
});
