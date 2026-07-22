import { describe, expect, it } from "vitest";

import {
  fuseRankedPets,
  normalizeSearchQuery,
  rankPetsLexically,
} from "@/lib/pets/search-ranking";

type Pet = {
  slug: string;
  displayName: string;
  description: string;
  tags: string[];
};

const pets: Pet[] = [
  {
    slug: "newest-glamour",
    displayName: "Glamour Guide",
    description: "A stylish coding companion",
    tags: ["fashion"],
  },
  {
    slug: "sexy-fox",
    displayName: "Scarlet Fox",
    description: "A confident red character",
    tags: ["vivid"],
  },
  {
    slug: "fox-prefix",
    displayName: "Sexy Fox Pilot",
    description: "A flight specialist",
    tags: ["aviation"],
  },
  {
    slug: "tag-match",
    displayName: "Night Coder",
    description: "A terminal companion",
    tags: ["sexy fox"],
  },
  {
    slug: "description-match",
    displayName: "Velvet Byte",
    description: "A sexy fox inspired coding companion",
    tags: ["night"],
  },
];

describe("pet search ranking", () => {
  it("normalizes Unicode, whitespace, length, and token count", () => {
    const longQuery = `${"ＳＥＸＹ ".repeat(14)}${"x".repeat(200)}`;
    const normalized = normalizeSearchQuery(longQuery);

    expect(normalized.text.startsWith("sexy sexy")).toBe(true);
    expect(normalized.text.length).toBeLessThanOrEqual(120);
    expect(normalized.tokens).toHaveLength(12);
    expect(normalized.text.match(/[\p{L}\p{N}]+/gu)).toHaveLength(12);
  });

  it("ranks exact identifiers before name prefixes, tags, and descriptions", () => {
    expect(
      rankPetsLexically(pets, "sexy fox").map((match) => match.pet.slug),
    ).toEqual([
      "sexy-fox",
      "fox-prefix",
      "tag-match",
      "description-match",
    ]);
  });

  it("treats a punctuated slug as an exact identifier", () => {
    const [match] = rankPetsLexically(pets, "sexy-fox");

    expect(match?.pet.slug).toBe("sexy-fox");
    expect(match?.exactIdentifier).toBe(true);
  });

  it("matches bounded typos in names and tags", () => {
    expect(
      rankPetsLexically(pets, "glamur").map((match) => match.pet.slug),
    ).toEqual(["newest-glamour"]);
  });

  it("does not return lexical candidates for unrelated text", () => {
    expect(rankPetsLexically(pets, "quantum banana")).toEqual([]);
  });

  it("does not invent a lexical tier by combining name and tag tokens", () => {
    expect(rankPetsLexically(pets, "glamour fashion")).toEqual([]);
  });

  it("fuses lexical and semantic ranks, pins exact matches, and drops weak semantic-only hits", () => {
    const lexical = rankPetsLexically(pets, "sexy fox");
    const fused = fuseRankedPets({
      pets,
      lexical,
      semantic: [
        { slug: "newest-glamour", score: 0.86 },
        { slug: "description-match", score: 0.82 },
        { slug: "tag-match", score: 0.2 },
      ],
      minSemanticScore: 0.5,
    });

    expect(fused[0]?.slug).toBe("sexy-fox");
    expect(fused).toContainEqual(pets[0]);
    expect(fused).toContainEqual(pets[4]);
    expect(fused.filter((pet) => pet.slug === "tag-match")).toHaveLength(1);
  });
});
