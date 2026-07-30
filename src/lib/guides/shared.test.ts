import { describe, expect, it } from "vitest";

import type { PublicPet } from "@/lib/pets/types";
import {
  buildGuideArticleJsonLd,
  formatGuideDate,
  formatMarkdownDecisionTable,
  GUIDE_AUTHOR_NAME,
  selectGuideExamplePets,
} from "@/lib/guides/shared";

describe("guide shared helpers", () => {
  it("selects example pets by popularity, recency, then name", () => {
    const pets = selectGuideExamplePets([
      pet({
        slug: "newer",
        displayName: "Newer",
        approvedAt: "2026-05-08T00:00:00.000Z",
        likeCount: 1,
      }),
      pet({
        slug: "popular",
        displayName: "Popular",
        approvedAt: "2026-05-01T00:00:00.000Z",
        downloadCount: 4,
      }),
      pet({
        slug: "alpha",
        displayName: "Alpha",
        approvedAt: "2026-05-08T00:00:00.000Z",
        likeCount: 1,
      }),
      pet({ slug: "last", displayName: "Last" }),
    ]);

    expect(pets.map((item) => item.slug)).toEqual(["popular", "alpha", "newer"]);
    expect(pets[0].installCommand).toBe(
      "npx @astandrik/codex-pets install popular",
    );
    expect(pets[0].pageUrl).toContain("/pets/popular");
  });

  it("honors the example pet limit", () => {
    const pets = selectGuideExamplePets(
      [
        pet({ slug: "one", downloadCount: 3 }),
        pet({ slug: "two", downloadCount: 2 }),
        pet({ slug: "three", downloadCount: 1 }),
      ],
      2,
    );

    expect(pets.map((item) => item.slug)).toEqual(["one", "two"]);
  });

  it("builds Article JSON-LD with maintainer byline and dates", () => {
    const jsonLd = buildGuideArticleJsonLd({
      path: "/guides/demo",
      title: "Demo guide",
      description: "Demo description.",
      datePublished: "2026-05-26",
      dateModified: "2026-07-29",
    });

    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Demo guide",
      datePublished: "2026-05-26",
      dateModified: "2026-07-29",
      author: {
        "@type": "Organization",
        name: GUIDE_AUTHOR_NAME,
      },
    });
    expect(GUIDE_AUTHOR_NAME).toBe("Codex Pets maintainers");
    expect(String(jsonLd.url)).toContain("/guides/demo");
  });

  it("supports TechArticle JSON-LD", () => {
    const jsonLd = buildGuideArticleJsonLd({
      path: "/guides/demo",
      title: "Demo guide",
      description: "Demo description.",
      datePublished: "2026-05-27",
      dateModified: "2026-07-29",
      type: "TechArticle",
    });

    expect(jsonLd["@type"]).toBe("TechArticle");
  });

  it("formats ISO dates for bylines in a stable English form", () => {
    expect(formatGuideDate("2026-05-27")).toBe("May 27, 2026");
    expect(formatGuideDate("2026-07-29")).toBe("July 29, 2026");
  });

  it("renders a markdown decision table with escaped cells", () => {
    const table = formatMarkdownDecisionTable([
      {
        surface: "MCP server (POST /mcp)",
        useWhen: "The agent supports MCP | tool calls.",
        example: "search_pets",
      },
    ]);

    expect(table).toContain("| Surface | Use when | Example |");
    expect(table).toContain("MCP server \\(POST /mcp\\)");
    expect(table).toContain("MCP \\| tool calls");
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
