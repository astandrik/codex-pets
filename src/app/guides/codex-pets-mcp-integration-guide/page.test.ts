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
});
