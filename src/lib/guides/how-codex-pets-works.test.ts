import { describe, expect, it } from "vitest";

import {
  buildHowCodexPetsWorksMarkdown,
  getHowCodexPetsWorksJsonLd,
  HOW_CODEX_PETS_WORKS_DIAGRAMS,
  HOW_CODEX_PETS_WORKS_PATH,
  HOW_CODEX_PETS_WORKS_SCREENSHOTS,
  HOW_CODEX_PETS_WORKS_TITLE,
} from "@/lib/guides/how-codex-pets-works";

describe("How Codex Pets works guide content", () => {
  it("defines four diagrams and two screenshots without time-sensitive metrics", () => {
    expect(HOW_CODEX_PETS_WORKS_DIAGRAMS).toHaveLength(4);
    expect(HOW_CODEX_PETS_WORKS_SCREENSHOTS).toHaveLength(2);

    const content = JSON.stringify([
      HOW_CODEX_PETS_WORKS_DIAGRAMS,
      HOW_CODEX_PETS_WORKS_SCREENSHOTS,
    ]);
    expect(content).not.toMatch(/\b153 approved\b|p95|NDCG|Recall@/i);
  });

  it("builds an illustrated markdown twin with the same public guide contract", () => {
    const markdown = buildHowCodexPetsWorksMarkdown();

    expect(markdown).toContain(`# ${HOW_CODEX_PETS_WORKS_TITLE}`);
    expect(markdown).toContain("## A pet pack's path");
    expect(markdown).toContain("## How a pet becomes searchable");
    expect(markdown).toContain("## Online hybrid search");
    expect(markdown).toContain("## Related pets without half-published results");
    expect(markdown.match(/!\[/g)).toHaveLength(6);
    expect(markdown).toContain("lexical results");
    expect(markdown).toContain("while the card is pending");
    expect(markdown).toContain("uses the heuristic order");
    expect(markdown).not.toContain(
      "previous compatible generation remains active",
    );
    expect(markdown).not.toContain("habr.com");
    expect(markdown).not.toMatch(/\b153 approved\b|p95|NDCG|Recall@/i);
  });

  it("publishes TechArticle structured data for the canonical route", () => {
    const jsonLd = getHowCodexPetsWorksJsonLd();

    expect(jsonLd).toMatchObject({
      "@type": "TechArticle",
      headline: HOW_CODEX_PETS_WORKS_TITLE,
      url: expect.stringContaining(HOW_CODEX_PETS_WORKS_PATH),
    });
  });
});
