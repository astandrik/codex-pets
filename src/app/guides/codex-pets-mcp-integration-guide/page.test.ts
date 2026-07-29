import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Codex Pets MCP integration guide", () => {
  it("uses a GET-able primary CTA instead of the POST-only MCP endpoint", () => {
    const source = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(source).toContain('const MCP_GUIDE_PRIMARY_CTA_PATH = "/mcp.md"');
    expect(source).toContain(
      'href={withBasePath(MCP_GUIDE_PRIMARY_CTA_PATH)}',
    );
    expect(source).not.toContain('href={withBasePath("/mcp")}');
  });

  it("renders the maintainer byline and the first-hand methodology section", () => {
    const source = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(source).toContain("formatGuideByline");
    expect(source).toContain("GUIDE_AUTHOR_NAME");
    expect(source).toContain("How we tested");
    expect(source).toContain("guide-decision-table");
    expect(source).toContain("MCP_GUIDE_QUERY_EXAMPLES");
  });

  it("dates the methodology intro by the actual check run date", () => {
    const source = readFileSync(new URL("page.tsx", import.meta.url), "utf8");

    expect(source).toContain("formatGuideDate(METHODOLOGY_RUN_DATE)");
    expect(source).not.toContain(
      "formatGuideDate(MCP_INTEGRATION_GUIDE_DATE_MODIFIED)",
    );
  });

  it("ranks example pets against the full approved catalog", () => {
    const pageSource = readFileSync(new URL("page.tsx", import.meta.url), "utf8");
    const routeSource = readFileSync(
      new URL("../codex-pets-mcp-integration-guide.md/route.ts", import.meta.url),
      "utf8",
    );

    for (const source of [pageSource, routeSource]) {
      expect(source).toContain("listApprovedPetsForSearch()");
      expect(source).not.toContain("listApprovedPets()");
    }
  });

  it("keeps the markdown route on the shared guide source", () => {
    const source = readFileSync(
      new URL("../codex-pets-mcp-integration-guide.md/route.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("buildMcpIntegrationGuideMarkdown");
  });

  it("aligns the markdown route cache with the approved-pet snapshot", () => {
    const source = readFileSync(
      new URL("../codex-pets-mcp-integration-guide.md/route.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300")',
    );
  });
});
