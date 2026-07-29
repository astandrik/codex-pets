import { describe, expect, it } from "vitest";

import type { PublicPet } from "@/lib/pets/types";
import {
  buildMcpIntegrationGuideMarkdown,
  getMcpIntegrationGuideJsonLd,
  MCP_GUIDE_DECISION_ROWS,
  MCP_GUIDE_QUERY_EXAMPLES,
  MCP_INTEGRATION_GUIDE_DATE_MODIFIED,
  MCP_INTEGRATION_GUIDE_DATE_PUBLISHED,
  selectMcpGuideExamplePets,
} from "@/lib/guides/codex-pets-mcp-integration";

describe("Codex Pets MCP integration guide content", () => {
  it("publishes maintainer byline dates", () => {
    expect(MCP_INTEGRATION_GUIDE_DATE_PUBLISHED).toBe("2026-05-27");
    expect(MCP_INTEGRATION_GUIDE_DATE_MODIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("documents at least three reproducible first-hand queries with run dates", () => {
    expect(MCP_GUIDE_QUERY_EXAMPLES.length).toBeGreaterThanOrEqual(3);
    for (const example of MCP_GUIDE_QUERY_EXAMPLES) {
      expect(example.command.length).toBeGreaterThan(0);
      expect(example.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(example.screenshot?.path).toMatch(
        /^\/guides\/mcp-integration\/.+\.png$/,
      );
    }
    const commands = MCP_GUIDE_QUERY_EXAMPLES.map(
      (example) => example.command,
    ).join("\n");
    expect(commands).toContain("/api/manifest");
    expect(commands).toContain("q=anime");
    expect(commands).toContain("/install");
  });

  it("provides a decision table for MCP vs HTTP vs markdown surfaces", () => {
    expect(MCP_GUIDE_DECISION_ROWS.length).toBeGreaterThanOrEqual(3);
    const surfaces = MCP_GUIDE_DECISION_ROWS.map((row) => row.surface).join(
      " ",
    );
    expect(surfaces).toContain("MCP");
    expect(surfaces).toMatch(/OpenAPI|JSON/);
    expect(surfaces).toMatch(/llms\.txt|markdown/i);
  });

  it("selects example pets by popularity, recency, then name", () => {
    const pets = selectMcpGuideExamplePets([
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

  it("builds markdown with byline, methodology, decision table, and pet links", () => {
    const markdown = buildMcpIntegrationGuideMarkdown([
      pet({ slug: "demo-pet", displayName: "Demo Pet", downloadCount: 2 }),
    ]);

    expect(markdown).toContain("# Codex Pets MCP integration guide");
    expect(markdown).toContain("Codex Pets maintainers");
    expect(markdown).toContain("May 27, 2026");
    expect(markdown).toContain("How we tested");
    expect(markdown).toContain("/api/manifest");
    expect(markdown).toContain("| Surface | Use when | Example |");
    expect(markdown).toContain("/pets/demo-pet)");
    expect(markdown).toContain("/openapi.json");
    expect(markdown).toContain("/llms-full.txt");
  });

  it("escapes hostile pet metadata in guide markdown", () => {
    const markdown = buildMcpIntegrationGuideMarkdown([
      pet({
        slug: "hostile",
        displayName: "Demo\n## Injected",
        downloadCount: 9,
      }),
    ]);

    expect(markdown).not.toContain("\n## Injected");
  });

  it("builds TechArticle JSON-LD with byline and dates", () => {
    const jsonLd = getMcpIntegrationGuideJsonLd();

    expect(jsonLd["@type"]).toBe("TechArticle");
    expect(jsonLd.datePublished).toBe("2026-05-27");
    expect(jsonLd.dateModified).toBe(MCP_INTEGRATION_GUIDE_DATE_MODIFIED);
    expect(jsonLd.author).toMatchObject({
      "@type": "Organization",
      name: "Codex Pets maintainers",
    });
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
