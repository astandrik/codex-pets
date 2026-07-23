import { describe, expect, it } from "vitest";

import {
  PET_VISION_V2_CANARIES,
  evaluatePetVisionCanary,
} from "@/lib/pets/search-vision-canaries";

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
});
