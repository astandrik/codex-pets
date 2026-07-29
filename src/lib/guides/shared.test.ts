import { describe, expect, it } from "vitest";

import {
  buildGuideArticleJsonLd,
  formatGuideDate,
  formatMarkdownDecisionTable,
  GUIDE_AUTHOR_NAME,
} from "@/lib/guides/shared";

describe("guide shared helpers", () => {
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
