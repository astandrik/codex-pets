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
      expected: [
        "API docs",
        "OpenAPI JSON",
        "MCP server",
        "auth.md",
        "Agent instructions: when to use Codex Pets",
      ],
    },
    {
      modulePath: "@/app/about.md/route",
      heading: "# About Codex Pets",
      expected: [
        "downloadable Codex pet packs",
        "Agent instructions: when to use Codex Pets",
        "Wikipedia and Wikidata",
      ],
    },
    {
      modulePath: "@/app/agents.md/route",
      heading: "# Codex Pets Agent Access",
      expected: [
        "codex mcp add codexPets",
        "Agent instructions: when to use Codex Pets",
        "MCP tools are read-only",
      ],
    },
    {
      modulePath: "@/app/mcp.md/route",
      heading: "# Codex Pets MCP server",
      expected: [
        "Streamable HTTP",
        "ui://codex-pets/pet-browser.html",
        "Content-Security-Policy",
      ],
    },
    {
      modulePath: "@/app/docs/api.md/route",
      heading: "# Codex Pets API docs",
      expected: [
        "GET /api/manifest",
        "POST /mcp",
        "Error responses",
        "Agent instructions: when to use Codex Pets",
      ],
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

describe("scoped llms.txt routes", () => {
  it.each([
    {
      modulePath: "@/app/developers/llms.txt/route",
      heading: "# Codex Pets developer llms.txt",
      expected: ["OpenAPI JSON", "MCP server", "Agent instructions"],
    },
    {
      modulePath: "@/app/docs/llms.txt/route",
      heading: "# Codex Pets API llms.txt",
      expected: ["GET /api/pets", "POST /mcp", "Error responses"],
    },
  ])("serves $modulePath as scoped plain text", async ({
    modulePath,
    heading,
    expected,
  }) => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    const { GET } = await import(modulePath);
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(body).toContain(heading);
    for (const text of expected) {
      expect(body).toContain(text);
    }

    vi.unstubAllEnvs();
  });
});

describe("MCP markdown security notes", () => {
  it("does not claim meta CSP enforces frame ancestors", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    const { GET } = await import("@/app/mcp.md/route");
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Content-Security-Policy");
    expect(body).not.toContain("frame-ancestors");

    vi.unstubAllEnvs();
  });
});
