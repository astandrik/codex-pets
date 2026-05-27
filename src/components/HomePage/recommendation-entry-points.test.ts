import { describe, expect, it } from "vitest";

import {
  buildHomeRecommendationEntryPoints,
  sliceHomeGalleryPets,
} from "@/components/HomePage/recommendation-entry-points";

const basePet = {
  slug: "boba",
  displayName: "Boba",
  tags: [] as string[],
  likeCount: 0,
  downloadCount: 0,
  installCount: 0,
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
};

describe("home recommendation entry points", () => {
  it("returns only style chips backed by existing approved pet tags", () => {
    const result = buildHomeRecommendationEntryPoints([
      { ...basePet, slug: "cute-one", displayName: "Cute One", tags: ["Cute"] },
      {
        ...basePet,
        slug: "minimal-one",
        displayName: "Minimal One",
        tags: ["minimal", "terminal"],
      },
    ]);

    expect(result.styleTags).toEqual([
      { tag: "cute", href: "/?tags=cute" },
      { tag: "minimal", href: "/?tags=minimal" },
    ]);
  });

  it("hides fake popular links when no approved pets have metrics", () => {
    const result = buildHomeRecommendationEntryPoints([
      { ...basePet, slug: "quiet", displayName: "Quiet", tags: ["cute"] },
    ]);

    expect(result.popularPets).toEqual([]);
    expect(result.recentPets).toEqual([
      {
        slug: "quiet",
        displayName: "Quiet",
        href: "/pets/quiet",
      },
    ]);
  });

  it("links popular and recent entries to real pet detail pages", () => {
    const result = buildHomeRecommendationEntryPoints([
      {
        ...basePet,
        slug: "popular",
        displayName: "Popular",
        likeCount: 2,
        downloadCount: 4,
        installCount: 1,
        approvedAt: "2026-05-03T00:00:00.000Z",
      },
      {
        ...basePet,
        slug: "newer",
        displayName: "Newer",
        likeCount: 1,
        approvedAt: "2026-05-04T00:00:00.000Z",
      },
    ]);

    expect(result.popularPets).toEqual([
      { slug: "popular", displayName: "Popular", href: "/pets/popular" },
      { slug: "newer", displayName: "Newer", href: "/pets/newer" },
    ]);
    expect(result.recentPets).toEqual([
      { slug: "newer", displayName: "Newer", href: "/pets/newer" },
      { slug: "popular", displayName: "Popular", href: "/pets/popular" },
    ]);
  });
});

describe("sliceHomeGalleryPets", () => {
  it("keeps all approved pets visible on the homepage", () => {
    const pets = Array.from({ length: 50 }, (_, index) => ({
      ...basePet,
      slug: `pet-${index}`,
      displayName: `Pet ${index}`,
    }));

    expect(sliceHomeGalleryPets(pets)).toHaveLength(50);
  });
});
