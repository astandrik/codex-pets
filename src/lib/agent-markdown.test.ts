import { describe, expect, it } from "vitest";

import { buildIndexMarkdown, markdownResponse } from "@/lib/agent-markdown";

describe("agent markdown sprite guidance", () => {
  it("documents both supported atlas versions in the index fallback", () => {
    const markdown = buildIndexMarkdown();

    expect(markdown).toContain(
      "Version 1 may omit spriteVersionNumber and uses a 1536 by 1872 pixel atlas arranged as eight columns and nine rows.",
    );
    expect(markdown).toContain(
      "Version 2 sets spriteVersionNumber to 2 and uses a 1536 by 2288 pixel atlas arranged as eight columns and eleven rows.",
    );
  });
});

describe("markdown response headers", () => {
  it("adds an absolute canonical link without dropping agent discovery links", () => {
    const response = markdownResponse("# Kuroa", {
      canonicalPath: "/pets/kuroa",
    });

    expect(response.headers.get("Link")).toContain(
      '<http://localhost:3000/pets/kuroa>; rel="canonical"',
    );
    expect(response.headers.get("Link")).toContain(
      '<http://localhost:3000/llms.txt>; rel="describedby"; type="text/plain"',
    );
    expect(response.headers.get("Link")).toContain(
      '<http://localhost:3000/openapi.json>; rel="service-desc"; type="application/json"',
    );
    expect(response.headers.get("Link")).toContain(
      '<http://localhost:3000/mcp>; rel="service"; type="application/json"',
    );
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("keeps standalone markdown out of search indexes", () => {
    const response = markdownResponse("# MCP");

    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, follow");
  });
});
