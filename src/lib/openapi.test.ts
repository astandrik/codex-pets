import { beforeEach, describe, expect, it, vi } from "vitest";

describe("buildOpenApiSpec", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("builds the public Codex Pets OpenAPI contract without admin routes", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { buildOpenApiSpec } = await import("@/lib/openapi");
    const spec = buildOpenApiSpec();

    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("Codex Pets API");
    expect(spec.servers).toEqual([{ url: "https://pets.example/codex-pets" }]);
    expect(spec.paths).toHaveProperty("/api/manifest");
    expect(spec.paths).toHaveProperty("/api/manifest.toon");
    expect(spec.paths).toHaveProperty("/api/pets");
    expect(spec.paths).toHaveProperty("/api/pets.toon");
    expect(spec.paths).toHaveProperty("/api/pets/{slug}");
    expect(spec.paths).toHaveProperty("/api/pets/{slug}.toon");
    expect(spec.paths).toHaveProperty("/api/tags");
    expect(spec.paths).toHaveProperty("/api/tags.toon");
    expect(spec.paths).toHaveProperty("/api/pets/{slug}/share");
    expect(spec.paths).toHaveProperty("/api/pets/{slug}/install");
    expect(spec.paths).toHaveProperty("/api/generation-requests");
    expect(spec.paths).toHaveProperty("/api/submissions/register");
    expect(spec.paths).toHaveProperty("/mcp");
    expect(spec.paths).toHaveProperty("/server.json");
    expect(spec.paths).toHaveProperty("/.well-known/mcp/server.json");
    expect(Object.keys(spec.paths).some((path) => path.includes("/admin"))).toBe(
      false,
    );
    expect(spec.components.securitySchemes).toMatchObject({
      AppSessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "codex_pets_session",
      },
      ProxyBasic: {
        type: "http",
        scheme: "basic",
      },
    });
    expect(spec.paths["/mcp"].post.summary).toContain("MCP");
    expect(spec.paths["/api/generation-requests"].post.security).toEqual([]);
  });
});
