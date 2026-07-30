import { describe, expect, it } from "vitest";

import {
  formatRelatedPetDescription,
  RELATED_PET_DESCRIPTION_MAX_LENGTH,
  selectRelatedPets,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";

const CURRENT = {
  slug: "current-pet",
  kind: "creature" as const,
  tags: ["space", "friendly"],
};

function candidate(
  overrides: Partial<RelatedPetCandidate> & { slug: string },
): RelatedPetCandidate {
  return {
    displayName: overrides.slug,
    kind: "creature",
    tags: [],
    description: `Description of ${overrides.slug}.`,
    approvedAt: "2026-05-01T00:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
    ...overrides,
  };
}

function slugsOf(pets: RelatedPetCandidate[]): string[] {
  return pets.map((pet) => pet.slug);
}

describe("selectRelatedPets", () => {
  it("ranks candidates with more shared tags above newer candidates", () => {
    const related = selectRelatedPets(
      [
        candidate({
          slug: "newer-one-tag",
          tags: ["space"],
          approvedAt: "2026-07-01T00:00:00.000Z",
        }),
        candidate({
          slug: "older-two-tags",
          tags: ["space", "friendly"],
          approvedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["older-two-tags", "newer-one-tag"]);
  });

  it("prefers the same kind as the current pet when shared tags tie", () => {
    const related = selectRelatedPets(
      [
        candidate({
          slug: "newer-other-kind",
          kind: "object",
          tags: ["space"],
          approvedAt: "2026-07-01T00:00:00.000Z",
        }),
        candidate({
          slug: "older-same-kind",
          kind: "creature",
          tags: ["space"],
          approvedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["older-same-kind", "newer-other-kind"]);
  });

  it("breaks shared-tag and kind ties by approvedAt descending", () => {
    const related = selectRelatedPets(
      [
        candidate({
          slug: "approved-earlier",
          tags: ["space"],
          approvedAt: "2026-05-02T00:00:00.000Z",
        }),
        candidate({
          slug: "approved-later",
          tags: ["space"],
          approvedAt: "2026-06-02T00:00:00.000Z",
        }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["approved-later", "approved-earlier"]);
  });

  it("falls back to createdAt when approvedAt is missing", () => {
    const related = selectRelatedPets(
      [
        candidate({
          slug: "approved-older",
          tags: ["space"],
          approvedAt: "2026-05-15T00:00:00.000Z",
          createdAt: "2026-05-10T00:00:00.000Z",
        }),
        candidate({
          slug: "no-approved-newer-created",
          tags: ["space"],
          approvedAt: null,
          createdAt: "2026-06-01T00:00:00.000Z",
        }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual([
      "no-approved-newer-created",
      "approved-older",
    ]);
  });

  it("sorts candidates with neither approvedAt nor createdAt last", () => {
    const related = selectRelatedPets(
      [
        candidate({
          slug: "no-dates",
          tags: ["space"],
          approvedAt: null,
          createdAt: "",
        }),
        candidate({ slug: "dated", tags: ["space"] }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["dated", "no-dates"]);
  });

  it("breaks full ties by slug ascending for a stable order", () => {
    const related = selectRelatedPets(
      [
        candidate({ slug: "zeta", tags: ["space"] }),
        candidate({ slug: "alpha", tags: ["space"] }),
        candidate({ slug: "mid", tags: ["space"] }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["alpha", "mid", "zeta"]);
  });

  it("scores shared tags by normalized unique sets so duplicates do not inflate", () => {
    const related = selectRelatedPets(
      [
        candidate({
          slug: "duplicate-space",
          tags: ["space", "SPACE", " space "],
          approvedAt: "2026-07-01T00:00:00.000Z",
        }),
        candidate({
          slug: "two-distinct",
          tags: ["space", "FRIENDLY"],
          approvedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["two-distinct", "duplicate-space"]);
  });

  it("normalizes the current pet tags before matching", () => {
    const related = selectRelatedPets(
      [
        candidate({
          slug: "newer-no-match",
          tags: ["unrelated"],
          approvedAt: "2026-07-01T00:00:00.000Z",
        }),
        candidate({
          slug: "older-space-match",
          tags: ["space"],
          approvedAt: "2026-05-02T00:00:00.000Z",
        }),
      ],
      { slug: "current-pet", kind: "creature", tags: [" Space ", "SPACE"] },
    );

    expect(slugsOf(related)).toEqual(["older-space-match", "newer-no-match"]);
  });

  it("excludes the current pet from its own related list", () => {
    const related = selectRelatedPets(
      [
        candidate({ slug: "current-pet", tags: ["space", "friendly"] }),
        candidate({ slug: "other-pet", tags: ["space"] }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["other-pet"]);
  });

  it("returns every candidate when fewer than the limit exist", () => {
    const related = selectRelatedPets(
      [candidate({ slug: "one" }), candidate({ slug: "two" })],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["one", "two"]);
  });

  it("returns an empty list for empty input", () => {
    expect(selectRelatedPets([], CURRENT)).toEqual([]);
  });

  it("takes at most four related pets by default", () => {
    const related = selectRelatedPets(
      [
        candidate({ slug: "fifth", tags: [] }),
        candidate({ slug: "first", tags: ["space", "friendly"] }),
        candidate({ slug: "fourth", tags: ["space"] }),
        candidate({ slug: "second", kind: "object", tags: ["friendly"] }),
        candidate({ slug: "third", tags: ["space"] }),
        candidate({ slug: "sixth", tags: [] }),
      ],
      CURRENT,
    );

    expect(slugsOf(related)).toEqual(["first", "fourth", "third", "second"]);
  });

  it("respects an explicit limit", () => {
    const related = selectRelatedPets(
      [
        candidate({ slug: "one", tags: ["space"] }),
        candidate({ slug: "two", tags: ["space"] }),
        candidate({ slug: "three", tags: ["space"] }),
      ],
      CURRENT,
      2,
    );

    expect(slugsOf(related)).toEqual(["one", "three"]);
  });
});

describe("formatRelatedPetDescription", () => {
  it("collapses whitespace into a single line", () => {
    expect(formatRelatedPetDescription("  first\nsecond\t\tthird  ")).toBe(
      "first second third",
    );
  });

  it("returns descriptions at or below the limit unchanged", () => {
    const exact = "x".repeat(RELATED_PET_DESCRIPTION_MAX_LENGTH);

    expect(RELATED_PET_DESCRIPTION_MAX_LENGTH).toBe(120);
    expect(formatRelatedPetDescription(exact)).toBe(exact);
  });

  it("hard-truncates beyond the limit with an ellipsis", () => {
    const formatted = formatRelatedPetDescription("a".repeat(130));

    expect(formatted).toBe(`${"a".repeat(119)}…`);
    expect(formatted.length).toBe(RELATED_PET_DESCRIPTION_MAX_LENGTH);
  });

  it("trims the trailing space left by the cut before the ellipsis", () => {
    const formatted = formatRelatedPetDescription(
      `${"x".repeat(118)} ${"y".repeat(20)}`,
    );

    expect(formatted).toBe(`${"x".repeat(118)}…`);
  });

  it("does not split a surrogate pair at the truncation boundary", () => {
    const formatted = formatRelatedPetDescription(
      `${"a".repeat(118)}😀 tail`,
    );

    expect(formatted).toBe(`${"a".repeat(118)}😀…`);
  });

  it("returns an empty string for empty input", () => {
    expect(formatRelatedPetDescription("")).toBe("");
  });
});
