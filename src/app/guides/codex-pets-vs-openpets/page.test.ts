import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Codex Pets vs OpenPets guide", () => {
  it("renders the maintainer byline and the first-hand methodology section", () => {
    const source = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(source).toContain("formatGuideByline");
    expect(source).toContain("GUIDE_AUTHOR_NAME");
    expect(source).toContain("How we tested");
    expect(source).toContain("guide-decision-table");
    expect(source).toContain("OPENPETS_QUERY_EXAMPLES");
    expect(source).toContain("example.responseExcerpt");
  });

  it("ranks example pets against the full approved catalog", () => {
    const pageSource = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const routeSource = readFileSync(
      new URL("../codex-pets-vs-openpets.md/route.ts", import.meta.url),
      "utf8",
    );

    for (const source of [pageSource, routeSource]) {
      expect(source).toContain("listApprovedPetsForSearch()");
      expect(source).not.toContain("listApprovedPets()");
    }
  });

  it("keeps the markdown route on the shared guide source", () => {
    const source = readFileSync(
      new URL("../codex-pets-vs-openpets.md/route.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("buildVsOpenPetsGuideMarkdown");
  });

  it("aligns the markdown route cache with the approved-pet snapshot", () => {
    const source = readFileSync(
      new URL("../codex-pets-vs-openpets.md/route.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300")',
    );
  });
});
