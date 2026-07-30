import { describe, expect, it } from "vitest";

import type { PublicPet } from "@/lib/pets/types";
import {
  buildVsVsCodePetsGuideMarkdown,
  getVsVsCodePetsGuideJsonLd,
  VS_VSCODE_PETS_DATE_MODIFIED,
  VS_VSCODE_PETS_DATE_PUBLISHED,
  VS_VSCODE_PETS_DECISION_ROWS,
  VS_VSCODE_PETS_QUERY_EXAMPLES,
  VS_VSCODE_PETS_SOURCES,
} from "@/lib/guides/codex-pets-vs-vscode-pets";

describe("Codex Pets vs VS Code Pets guide content", () => {
  it("publishes maintainer byline dates", () => {
    expect(VS_VSCODE_PETS_DATE_PUBLISHED).toBe("2026-05-26");
    expect(VS_VSCODE_PETS_DATE_MODIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("documents at least four reproducible first-hand queries with run dates", () => {
    expect(VS_VSCODE_PETS_QUERY_EXAMPLES.length).toBeGreaterThanOrEqual(4);
    for (const example of VS_VSCODE_PETS_QUERY_EXAMPLES) {
      expect(example.command.length).toBeGreaterThan(0);
      expect(example.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(example.responseExcerpt).toMatch(/^\{/);
      expect(example.responseExcerpt.length).toBeGreaterThan(20);
    }
    const commands = VS_VSCODE_PETS_QUERY_EXAMPLES.map(
      (example) => example.command,
    ).join("\n");
    expect(commands).toContain("/api/manifest");
    expect(commands).toContain("/install");
    expect(commands).toContain("q=cat");
    expect(commands).toContain("/share");
  });

  it("provides a decision table naming when each product fits", () => {
    expect(VS_VSCODE_PETS_DECISION_ROWS.length).toBeGreaterThanOrEqual(4);
    const surfaces = VS_VSCODE_PETS_DECISION_ROWS.map(
      (row) => `${row.surface} ${row.useWhen} ${row.example}`,
    ).join(" ");
    expect(surfaces).toContain("Codex Pets");
    expect(surfaces).toContain("VS Code Pets");
    expect(surfaces).toContain("tonybaloney.vscode-pets");
  });

  it("links competitor claims to official sources", () => {
    const urls = VS_VSCODE_PETS_SOURCES.map((source) => source.url).join(" ");
    expect(urls).toContain(
      "marketplace.visualstudio.com/items?itemName=tonybaloney.vscode-pets",
    );
    expect(urls).toContain("github.com/tonybaloney/vscode-pets");
  });

  it("builds markdown with byline, methodology, decision table, and five pet links", () => {
    const markdown = buildVsVsCodePetsGuideMarkdown([
      pet({ slug: "one", displayName: "One", downloadCount: 6 }),
      pet({ slug: "two", displayName: "Two", downloadCount: 5 }),
      pet({ slug: "three", displayName: "Three", downloadCount: 4 }),
      pet({ slug: "four", displayName: "Four", downloadCount: 3 }),
      pet({ slug: "five", displayName: "Five", downloadCount: 2 }),
      pet({ slug: "six", displayName: "Six", downloadCount: 1 }),
    ]);

    expect(markdown).toContain("# Codex Pets vs VS Code Pets");
    expect(markdown).toContain("Codex Pets maintainers");
    expect(markdown).toContain("May 26, 2026");
    expect(markdown).toContain("How we tested");
    expect(markdown).toMatch(/did not run/i);
    expect(markdown).toContain("```json");
    expect(markdown).toContain("| Surface | Use when | Example |");
    expect(markdown.match(/\/pets\//g)?.length).toBeGreaterThanOrEqual(5);
    expect(markdown).toContain("marketplace.visualstudio.com");
    expect(markdown).not.toContain("FAQPage");
  });

  it("escapes hostile pet metadata in guide markdown", () => {
    const markdown = buildVsVsCodePetsGuideMarkdown([
      pet({
        slug: "hostile",
        displayName: "Demo\n## Injected",
        downloadCount: 9,
      }),
    ]);

    expect(markdown).not.toContain("\n## Injected");
  });

  it("builds Article JSON-LD with byline and dates", () => {
    const jsonLd = getVsVsCodePetsGuideJsonLd();

    expect(jsonLd["@type"]).toBe("Article");
    expect(jsonLd.datePublished).toBe("2026-05-26");
    expect(jsonLd.dateModified).toBe(VS_VSCODE_PETS_DATE_MODIFIED);
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
