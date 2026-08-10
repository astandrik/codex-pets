import { describe, expect, it } from "vitest";

import {
  buildRelatedPetDescriptionText,
  buildRelatedPetThemeQuery,
  buildRelatedPetTopicText,
  normalizeRelatedPetSemanticTags,
  normalizeRelatedPetTextFirstTags,
  normalizeRelatedPetTopicTags,
} from "@/lib/pets/related-pets-semantics.mjs";

describe("related pet semantic tags", () => {
  it("normalizes, sorts, deduplicates, and removes operational tags", () => {
    expect(
      normalizeRelatedPetSemanticTags([
        " Gothic ",
        "ｇｏｔｈｉｃ",
        "CC0",
        "public-domain",
        "sprite",
        "spritesheet",
        "v2",
        "V12",
        "license-mit",
        "source-github",
        "detailed",
        "detaiiled",
        "Vampire",
      ]),
    ).toEqual(["detaiiled", "detailed", "gothic", "vampire"]);
  });

  it("removes v9-only operational detail tags without changing v8", () => {
    const tags = ["anime", "chibi", "girl", "detailed", "detaiiled"];

    expect(normalizeRelatedPetSemanticTags(tags)).toEqual([
      "anime",
      "chibi",
      "detaiiled",
      "detailed",
      "girl",
    ]);
    expect(normalizeRelatedPetTextFirstTags(tags)).toEqual([
      "anime",
      "chibi",
      "girl",
    ]);
  });

  it("builds the v9 description text without tags", () => {
    expect(
      buildRelatedPetDescriptionText({
        displayName: " Ｖｅｌｖｅｔ Byte ",
        description: " A gothic coding character. ",
        kind: "character",
        tags: ["anime", "chibi", "gothic"],
      }),
    ).toBe(
      "name: Velvet Byte\nkind: character\ndescription: A gothic coding character.",
    );
  });

  it("builds the V10 topic text without generic tags or description fallback", () => {
    const input = {
      displayName: " Ｄｒａｃｕｌａ ",
      description: "This description belongs only to the primary contour.",
      kind: "character" as const,
      tags: [
        "Vampire",
        "Gothic",
        "girl",
        "anime",
        "chibi",
        "detailed",
        "source-github",
      ],
    };

    expect(normalizeRelatedPetTopicTags(input.tags)).toEqual([
      "gothic",
      "vampire",
    ]);
    expect(buildRelatedPetTopicText(input)).toBe(
      "name: Dracula\nkind: character\ntopics: gothic, vampire",
    );
    expect(buildRelatedPetTopicText({ ...input, tags: ["anime", "cc0"] }))
      .toBe("name: Dracula\nkind: character");
  });

  it("builds a stable name, kind, and topics query", () => {
    expect(
      buildRelatedPetThemeQuery({
        displayName: " Dracula ",
        description: "A visual description that should not be used.",
        kind: "character",
        tags: ["Vampire", "gothic", "cc0", "Gothic"],
      }),
    ).toBe("name: Dracula\nkind: character\ntopics: gothic, vampire");
  });

  it("uses the description only when no semantic tags remain", () => {
    expect(
      buildRelatedPetThemeQuery({
        displayName: "Asset",
        description: " A public-domain creature. ",
        kind: "creature",
        tags: ["cc0", "source-github", "v2"],
      }),
    ).toBe(
      "name: Asset\nkind: creature\ndescription: A public-domain creature.",
    );
  });
});
