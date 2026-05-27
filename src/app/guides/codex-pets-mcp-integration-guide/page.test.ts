import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("Codex Pets MCP integration guide", () => {
  it("uses a GET-able primary CTA instead of the POST-only MCP endpoint", () => {
    const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

    expect(source).toContain('const MCP_GUIDE_PRIMARY_CTA_PATH = "/mcp.md"');
    expect(source).toContain(
      'href={withBasePath(MCP_GUIDE_PRIMARY_CTA_PATH)}',
    );
    expect(source).not.toContain('href={withBasePath("/mcp")}');
  });
});
