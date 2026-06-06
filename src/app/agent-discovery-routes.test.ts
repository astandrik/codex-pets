import { describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: repositoryMocks.listApprovedPets,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: unknown) => callback,
}));

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
        "idempotency_key_in_progress",
        "Agent instructions: when to use Codex Pets",
      ],
    },
    {
      modulePath: "@/app/auth.md/route",
      heading: "# Codex Pets auth",
      expected: ["Public read endpoints", "AppSessionCookie", "ProxyBasic"],
    },
    {
      modulePath: "@/app/pricing.md/route",
      heading: "# Codex Pets pricing",
      expected: ["Free community registry", "no paid plans", "best-effort"],
    },
    {
      modulePath: "@/app/terms.md/route",
      heading: "# Codex Pets terms",
      expected: ["Free community registry", "moderated", "no SLA"],
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

describe("guide markdown routes", () => {
  it.each([
    {
      modulePath: "@/app/guides/best-codex-pets-for-ai-coding-agents.md/route",
      heading: "# Best Codex pets for AI coding agents",
      expected: [
        "Best Codex pets to try first",
        "npx @astandrik/codex-pets install kuroa",
        "https://pets.example/pets/kuroa",
        "https://pets.example/api/manifest",
      ],
    },
    {
      modulePath: "@/app/guides/codex-pets-mcp-integration-guide.md/route",
      heading: "# Codex Pets MCP integration guide",
      expected: [
        "codex mcp add codexPets",
        "https://pets.example/mcp",
        "https://pets.example/.well-known/mcp/server-card.json",
      ],
    },
    {
      modulePath: "@/app/guides/codex-pets-vs-vscode-pets.md/route",
      heading: "# Codex Pets vs VS Code Pets",
      expected: ["VS Code Pets", "OpenAPI", "llms.txt", "MCP"],
    },
    {
      modulePath: "@/app/guides/codex-pets-vs-openpets.md/route",
      heading: "# Codex Pets vs OpenPets",
      expected: ["OpenPets", "desktop", "public registry", "MCP"],
    },
  ])("serves $modulePath as markdown", async ({
    modulePath,
    heading,
    expected,
  }) => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.listApprovedPets.mockResolvedValue([
      {
        id: "pet_kuroa",
        slug: "kuroa",
        displayName: "Kuroa",
        description: "A chibi anime Codex pet pack.",
        spritesheetUrl: "/api/assets/kuroa/sheet.webp",
        petJsonUrl: "/api/assets/kuroa/pet.json",
        zipUrl: "/api/assets/kuroa/package.zip",
        spritesheetExt: "webp",
        kind: "creature",
        tags: ["anime", "chibi"],
        status: "approved",
        ownerName: "Creator",
        ownerProfileSlug: "creator",
        ownerAvatarUrl: null,
        contactEmail: "private@example.com",
        createdAt: "2026-05-01T00:00:00.000Z",
        approvedAt: "2026-05-02T00:00:00.000Z",
        downloadCount: 3,
        installCount: 2,
        likeCount: 1,
      },
    ]);

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
    expect(body).not.toContain("private@example.com");
    expect(body).not.toContain("/admin");

    vi.unstubAllEnvs();
  });
});

describe("scoped llms.txt routes", () => {
  it.each([
    {
      modulePath: "@/app/developers/llms.txt/route",
      heading: "# Codex Pets developer llms.txt",
      expected: [
        "OpenAPI JSON",
        "MCP server",
        "Pricing markdown",
        "Terms markdown",
        "OAuth Protected Resource metadata",
        "Agent instructions",
      ],
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
    expect(body).toContain("/.well-known/oauth-protected-resource/mcp");
    expect(body).not.toContain("frame-ancestors");

    vi.unstubAllEnvs();
  });

  it("describes MCP App CSP as origin-scoped when basePath is configured", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { GET } = await import("@/app/mcp.md/route");
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain(
      "scopes connect-src, static resources, and base-uri to the public origin https://pets.example",
    );
    expect(body).toContain(
      "CSP source expressions cannot scope those directives to /codex-pets",
    );
    expect(body).not.toContain(
      "scopes connect-src, static resources, and base-uri to https://pets.example/codex-pets",
    );

    vi.unstubAllEnvs();
  });
});
