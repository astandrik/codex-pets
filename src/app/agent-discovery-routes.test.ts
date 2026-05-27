import { describe, expect, it, vi } from "vitest";

describe("markdown agent discovery routes", () => {
  it.each([
    {
      modulePath: "@/app/index.md/route",
      heading: "# Codex Pets",
      expected: [
        "OpenAPI JSON",
        "MCP endpoint",
        "Developer portal",
        "Codex Pets retrieval brief",
        "MCP tools are read-only",
      ],
    },
    {
      modulePath: "@/app/developers.md/route",
      heading: "# Codex Pets Developer Portal",
      expected: ["API docs", "OpenAPI JSON", "MCP server", "auth.md"],
    },
    {
      modulePath: "@/app/docs/api.md/route",
      heading: "# Codex Pets API docs",
      expected: ["GET /api/manifest", "POST /mcp", "Error responses"],
    },
    {
      modulePath: "@/app/auth.md/route",
      heading: "# Codex Pets auth",
      expected: ["Public read endpoints", "AppSessionCookie", "ProxyBasic"],
    },
  ])("serves $modulePath as markdown", async ({ modulePath, heading, expected }) => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    const { GET } = await import(modulePath);
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(body).toContain(heading);
    for (const text of expected) {
      expect(body).toContain(text);
    }

    vi.unstubAllEnvs();
  });
});
