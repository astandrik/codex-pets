import { describe, expect, it } from "vitest";

import type { PublicPet } from "@/lib/pets/types";
import {
  buildBestCodexPetGuideSections,
  buildBestCodexPetGuideSummary,
  buildBestCodexPetsGuideMarkdown,
} from "@/lib/guides/best-codex-pets";

describe("best Codex Pets guide selection", () => {
  it("selects matching pets by section and sorts by popularity, recency, then name", () => {
    const sections = buildBestCodexPetGuideSections([
      pet({
        slug: "newer-anime",
        displayName: "Newer Anime",
        tags: ["anime"],
        approvedAt: "2026-05-08T00:00:00.000Z",
        likeCount: 1,
      }),
      pet({
        slug: "popular-anime",
        displayName: "Popular Anime",
        tags: ["anime", "chibi"],
        approvedAt: "2026-05-01T00:00:00.000Z",
        downloadCount: 4,
        installCount: 2,
      }),
      pet({
        slug: "alpha-anime",
        displayName: "Alpha Anime",
        tags: ["anime"],
        approvedAt: "2026-05-08T00:00:00.000Z",
        likeCount: 1,
      }),
      pet({ slug: "anime-4", displayName: "Anime 4", tags: ["anime"] }),
      pet({ slug: "anime-5", displayName: "Anime 5", tags: ["anime"] }),
      pet({ slug: "anime-6", displayName: "Anime 6", tags: ["anime"] }),
      pet({ slug: "pixel-pal", displayName: "Pixel Pal", tags: ["pixel"] }),
    ]);

    const anime = sections.find((section) => section.id === "anime");
    const pixel = sections.find((section) => section.id === "pixel");

    expect(anime?.pets.map((item) => item.slug)).toEqual([
      "popular-anime",
      "alpha-anime",
      "newer-anime",
      "anime-4",
      "anime-5",
    ]);
    expect(anime?.pets).toHaveLength(5);
    expect(anime?.pets[0]).toMatchObject({
      displayName: "Popular Anime",
      installCommand: "npx @astandrik/codex-pets install popular-anime",
      reason: expect.stringContaining("anime"),
    });
    expect(pixel?.pets.map((item) => item.slug)).toEqual(["pixel-pal"]);
  });

  it("builds an answer-first summary from the first available picks", () => {
    const sections = buildBestCodexPetGuideSections([
      pet({
        slug: "kuroa",
        displayName: "Kuroa",
        tags: ["anime", "chibi"],
        downloadCount: 3,
      }),
      pet({
        slug: "foggy-hedgehog",
        displayName: "Foggy Hedgehog",
        tags: ["cute", "cozy"],
        downloadCount: 2,
      }),
    ]);

    expect(buildBestCodexPetGuideSummary(sections)).toBe(
      "Best Codex pets to try first: Kuroa for anime, Foggy Hedgehog for cute and cozy.",
    );
  });

  it("serializes hostile pet metadata in guide markdown as text", () => {
    const sections = buildBestCodexPetGuideSections([
      pet({
        slug: "hostile",
        displayName: "Kuroa\n## Injected Heading",
        tags: [
          "anime",
          "[tag](https://evil.example/tag)",
          "cute\n- injected item",
        ],
      }),
    ]);
    const markdown = buildBestCodexPetsGuideMarkdown(sections);

    expect(markdown).toContain("Kuroa \\#\\# Injected Heading");
    expect(markdown).not.toContain("\n## Injected Heading");
    expect(markdown).not.toContain("[tag](https://evil.example/tag)");
    expect(markdown).not.toContain("\n- injected item");
  });
});

function pet(overrides: Partial<PublicPet>): PublicPet {
  const slug = overrides.slug ?? "demo";

  return {
    id: `pet_${slug}`,
    slug,
    displayName: overrides.displayName ?? "Demo Pet",
    description: overrides.description ?? "A demo Codex pet pack.",
    spritesheetUrl: overrides.spritesheetUrl ?? `/api/assets/${slug}/sheet.webp`,
    petJsonUrl: overrides.petJsonUrl ?? `/api/assets/${slug}/pet.json`,
    zipUrl: overrides.zipUrl ?? `/api/assets/${slug}/package.zip`,
    spritesheetExt: overrides.spritesheetExt ?? "webp",
    kind: overrides.kind ?? "creature",
    tags: overrides.tags ?? [],
    status: overrides.status ?? "approved",
    ownerName: overrides.ownerName ?? "Creator",
    ownerProfileSlug: overrides.ownerProfileSlug ?? "creator",
    ownerAvatarUrl: overrides.ownerAvatarUrl ?? null,
    contactEmail: overrides.contactEmail ?? null,
    createdAt: overrides.createdAt ?? "2026-05-01T00:00:00.000Z",
    approvedAt: overrides.approvedAt ?? "2026-05-02T00:00:00.000Z",
    downloadCount: overrides.downloadCount ?? 0,
    installCount: overrides.installCount ?? 0,
    likeCount: overrides.likeCount ?? 0,
  };
}
