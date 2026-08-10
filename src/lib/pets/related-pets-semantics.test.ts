import { describe, expect, it } from "vitest";

import {
  buildRelatedPetThemeQuery,
  normalizeRelatedPetSemanticTags,
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
        "Vampire",
      ]),
    ).toEqual(["gothic", "vampire"]);
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
