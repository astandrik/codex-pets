import { describe, expect, it } from "vitest";

import {
  buildGalleryHref,
  hasGalleryFilters,
  matchesGalleryFilters,
  normalizeGalleryQuery,
  normalizeGalleryTags,
  parseGalleryFilters,
  pickSuggestedGalleryTags,
  serializeGalleryFilters,
} from "@/lib/pets/gallery-filters";

const pets = [
  {
    displayName: "Orbit Otter",
    description: "Friendly space helper",
    kind: "creature" as const,
    tags: ["space", "friendly"],
  },
  {
    displayName: "Terminal Cube",
    description: "Green object for shell sessions",
    kind: "object" as const,
    tags: ["terminal", "green"],
  },
  {
    displayName: "Review Sprite",
    description: "PR review companion",
    kind: "character" as const,
    tags: ["review", "space"],
  },
];

describe("gallery filters", () => {
  it("parses and normalizes query, kind, and tags from search params", () => {
    expect(
      parseGalleryFilters({
        q: "  Space   Helper ",
        kind: "invalid",
        tags: [" Terminal,space ", "friendly", "space"],
      }),
    ).toEqual({
      query: "space helper",
      kind: "all",
      tags: ["friendly", "space", "terminal"],
    });
  });

  it("deduplicates, sorts, and caps tags", () => {
    expect(
      normalizeGalleryTags([
        "zeta",
        "alpha",
        "beta",
        "gamma",
        "delta",
        "epsilon",
        "eta",
        "theta",
        "iota",
        "alpha",
      ]),
    ).toEqual([
      "alpha",
      "beta",
      "delta",
      "epsilon",
      "eta",
      "gamma",
      "iota",
      "theta",
    ]);
  });

  it("normalizes Unicode and bounds public search queries", () => {
    expect(normalizeGalleryQuery(`  ＳＥＸＹ   ${"x".repeat(200)}`)).toBe(
      `sexy ${"x".repeat(115)}`,
    );
  });

  it("serializes canonical gallery URLs", () => {
    expect(
      serializeGalleryFilters({
        query: "space helper",
        kind: "creature",
        tags: ["terminal", "space"],
      }),
    ).toBe("q=space%20helper&kind=creature&tags=space,terminal");
    expect(buildGalleryHref({ tags: ["space", "terminal"] })).toBe(
      "/?tags=space,terminal",
    );
  });

  it("detects applied filters after normalization", () => {
    expect(hasGalleryFilters()).toBe(false);
    expect(hasGalleryFilters({ query: "  " })).toBe(false);
    expect(hasGalleryFilters({ query: "space" })).toBe(true);
    expect(hasGalleryFilters({ kind: "creature" })).toBe(true);
    expect(hasGalleryFilters({ tags: ["space"] })).toBe(true);
  });

  it("matches text, kind, and exact AND tags", () => {
    expect(
      pets.filter((pet) =>
        matchesGalleryFilters(pet, {
          query: "space",
          kind: "creature",
          tags: ["friendly"],
        }),
      ),
    ).toEqual([pets[0]]);
    expect(
      pets.filter((pet) => matchesGalleryFilters(pet, { tags: ["space"] })),
    ).toEqual([pets[0], pets[2]]);
    expect(
      pets.filter((pet) =>
        matchesGalleryFilters(pet, { tags: ["space", "terminal"] }),
      ),
    ).toEqual([]);
  });

  it("picks selected tags first and fills the rest by weighted random", () => {
    const suggested = pickSuggestedGalleryTags(pets, ["terminal"], {
      limit: 4,
      random: () => 0,
    });

    expect(suggested).toEqual(["terminal", "space", "friendly", "green"]);
  });

  it("does not duplicate selected tags and handles small tag sets", () => {
    const suggested = pickSuggestedGalleryTags([pets[0]], ["space"], {
      limit: 8,
      random: () => 0.99,
    });

    expect(suggested).toEqual(["space", "friendly"]);
  });
});
