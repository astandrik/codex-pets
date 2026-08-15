import { describe, expect, it } from "vitest";

import {
  buildRelatedPetDescriptionText,
  normalizeRelatedPetTopicTags,
} from "@/lib/pets/related-pets-semantics.mjs";

describe("current related pet semantic inputs", () => {
  it("builds the description embedding text without tags", () => {
    expect(buildRelatedPetDescriptionText({
      displayName: " Ｖｅｌｖｅｔ Byte ",
      description: " A gothic coding character. ",
      kind: "character",
      tags: ["anime", "chibi", "gothic"],
    })).toBe(
      "name: Velvet Byte\nkind: character\ndescription: A gothic coding character.",
    );
  });

  it("normalizes only meaningful topics used by sparse fallback", () => {
    expect(normalizeRelatedPetTopicTags([
      " Gothic ",
      "ｇｏｔｈｉｃ",
      "Vampire",
      "girl",
      "anime",
      "chibi",
      "detailed",
      "detaiiled",
      "CC0",
      "public-domain",
      "sprite",
      "spritesheet",
      "v2",
      "license-mit",
      "source-github",
    ])).toEqual(["gothic", "vampire"]);
  });
});
