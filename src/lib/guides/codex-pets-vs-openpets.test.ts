import { describe, expect, it } from "vitest";

import type { PublicPet } from "@/lib/pets/types";
import {
  buildVsOpenPetsGuideMarkdown,
  getVsOpenPetsGuideJsonLd,
  OPENPETS_DATE_MODIFIED,
  OPENPETS_DATE_PUBLISHED,
  OPENPETS_DECISION_ROWS,
  OPENPETS_QUERY_EXAMPLES,
  OPENPETS_SOURCES,
} from "@/lib/guides/codex-pets-vs-openpets";

describe("Codex Pets vs OpenPets guide content", () => {
  it("publishes maintainer byline dates", () => {
    expect(OPENPETS_DATE_PUBLISHED).toBe("2026-05-27");
    expect(OPENPETS_DATE_MODIFIED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("documents at least five reproducible first-hand queries with run dates", () => {
    expect(OPENPETS_QUERY_EXAMPLES.length).toBeGreaterThanOrEqual(5);
    for (const example of OPENPETS_QUERY_EXAMPLES) {
      expect(example.command.length).toBeGreaterThan(0);
      expect(example.runDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(example.responseExcerpt.length).toBeGreaterThan(20);
      if (example.language === "toon") {
        expect(example.responseExcerpt).toContain("pets[");
      } else {
        expect(example.responseExcerpt).toMatch(/^\{/);
        expect(() => JSON.parse(example.responseExcerpt)).not.toThrow();
      }
    }
    const commands = OPENPETS_QUERY_EXAMPLES.map(
      (example) => example.command,
    ).join("\n");
    expect(commands).toContain("/api/pets/kesha");
    expect(commands).toContain("/api/tags");
    expect(commands).toContain("kind=character");
    expect(commands).toContain("pets.toon");
    expect(commands).toContain("openpets.dev/pets/catalog.v3.json");
  });

  it("provides a decision table naming when each product fits", () => {
    expect(OPENPETS_DECISION_ROWS.length).toBeGreaterThanOrEqual(4);
    const surfaces = OPENPETS_DECISION_ROWS.map(
      (row) => `${row.surface} ${row.useWhen} ${row.example}`,
    ).join(" ");
    expect(surfaces).toContain("Codex Pets");
    expect(surfaces).toContain("OpenPets");
    expect(surfaces).toContain("@open-pets/mcp");
  });

  it("links competitor claims to verified sources", () => {
    const urls = OPENPETS_SOURCES.map((source) => source.url).join(" ");
    expect(urls).toContain("openpets.dev/docs");
    expect(urls).toContain("openpets.dev/pets/catalog.v3.json");
  });

  it("builds markdown with byline, methodology, decision table, and five pet links", () => {
    const markdown = buildVsOpenPetsGuideMarkdown([
      pet({ slug: "one", displayName: "One", downloadCount: 6 }),
      pet({ slug: "two", displayName: "Two", downloadCount: 5 }),
      pet({ slug: "three", displayName: "Three", downloadCount: 4 }),
      pet({ slug: "four", displayName: "Four", downloadCount: 3 }),
      pet({ slug: "five", displayName: "Five", downloadCount: 2 }),
      pet({ slug: "six", displayName: "Six", downloadCount: 1 }),
    ]);

    expect(markdown).toContain("# Codex Pets vs OpenPets");
    expect(markdown).toContain("Codex Pets maintainers");
    expect(markdown).toContain("May 27, 2026");
    expect(markdown).toContain("How we tested");
    expect(markdown).toMatch(/did not (install|run)/i);
    expect(markdown).toContain("```json");
    expect(markdown).toContain("```toon");
    expect(markdown).toContain("| Surface | Use when | Example |");
    expect(markdown.match(/\/pets\//g)?.length).toBeGreaterThanOrEqual(5);
    expect(markdown).toContain("openpets.dev");
    expect(markdown).not.toContain("FAQPage");
  });

  it("escapes hostile pet metadata in guide markdown", () => {
    const markdown = buildVsOpenPetsGuideMarkdown([
      pet({
        slug: "hostile",
        displayName: "Demo\n## Injected",
        downloadCount: 9,
      }),
    ]);

    expect(markdown).not.toContain("\n## Injected");
  });

  it("builds Article JSON-LD with byline and dates", () => {
    const jsonLd = getVsOpenPetsGuideJsonLd();

    expect(jsonLd["@type"]).toBe("Article");
    expect(jsonLd.datePublished).toBe("2026-05-27");
    expect(jsonLd.dateModified).toBe(OPENPETS_DATE_MODIFIED);
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
