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
    expect(spec.info.description).toContain("agent/developer contract subset");
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
    expect(spec.paths).toHaveProperty("/.well-known/mcp");
    expect(spec.paths).toHaveProperty("/.well-known/mcp/server-card.json");
    expect(spec.paths).toHaveProperty("/server.json");
    expect(spec.paths).toHaveProperty("/.well-known/mcp/server.json");
    expect(spec.paths).toHaveProperty("/index.md");
    expect(spec.paths).toHaveProperty("/developers.md");
    expect(spec.paths).toHaveProperty("/docs/api.md");
    expect(spec.paths).toHaveProperty("/auth.md");
    expect(spec.paths).toHaveProperty("/pricing");
    expect(spec.paths).toHaveProperty("/pricing.md");
    expect(spec.paths).toHaveProperty("/terms");
    expect(spec.paths).toHaveProperty("/terms.md");
    expect(spec.paths).toHaveProperty("/.well-known/oauth-protected-resource");
    expect(spec.paths).toHaveProperty("/.well-known/oauth-protected-resource/mcp");
    expect(spec.paths).not.toHaveProperty("/api/pets/{slug}/download");
    expect(spec.info.description).toContain("stable v1 endpoints");
    expect(spec.info.description).toContain("deprecation notice");
    expect(spec.paths["/api/pets/{slug}/install"]).not.toHaveProperty("post");
    expect(spec.paths["/api/pets/{slug}"]).not.toHaveProperty("post");
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
    expect(spec.paths["/.well-known/mcp"].post.summary).toContain("MCP");
    expect(spec.paths["/mcp"].post.responses["403"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/JsonRpcErrorResponse",
    });
    expect(spec.paths["/mcp"].post.responses["500"].content["application/json"].schema).toEqual({
      $ref: "#/components/schemas/JsonRpcErrorResponse",
    });
    expect(spec.paths["/mcp"].post.responses).not.toHaveProperty("405");
    expect(
      spec.paths["/.well-known/mcp"].post.responses["403"].content["application/json"].schema,
    ).toEqual({
      $ref: "#/components/schemas/JsonRpcErrorResponse",
    });
    expect(
      spec.paths["/.well-known/mcp"].post.responses["500"].content["application/json"].schema,
    ).toEqual({
      $ref: "#/components/schemas/JsonRpcErrorResponse",
    });
    expect(spec.paths["/.well-known/mcp"].post.responses).not.toHaveProperty("405");
    expect(spec.paths["/api/generation-requests"].post.security).toEqual([]);
    expect(spec.paths["/api/generation-requests"].post.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Idempotency-Key",
          in: "header",
          required: false,
        }),
      ]),
    );
    expect(spec.paths["/api/generation-requests"].post.responses).toHaveProperty("409");
    expect(spec.paths["/api/generation-requests"].post.responses).toHaveProperty("503");
    expect(spec.paths["/api/submissions/register"].post.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Idempotency-Key",
          in: "header",
          required: false,
        }),
      ]),
    );
    expect(spec.paths["/api/submissions/register"].post.responses).toHaveProperty("409");
    expect(spec.paths["/api/submissions/register"].post.responses).toHaveProperty("503");
    expect(spec.components.schemas.ErrorResponse).toMatchObject({
      required: ["error", "code", "message"],
      properties: {
        error: { type: "string" },
        code: { type: "string" },
        message: { type: "string" },
        hint: { type: "string" },
      },
    });
    expect(spec.components.schemas.JsonRpcErrorResponse).toMatchObject({
      required: ["jsonrpc", "error", "id"],
      properties: {
        jsonrpc: { type: "string", const: "2.0" },
        error: {
          type: "object",
          required: ["code", "message"],
        },
      },
    });
  });

  it("omits the root slash from server URL when no base path is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { buildOpenApiSpec } = await import("@/lib/openapi");
    const spec = buildOpenApiSpec();

    expect(spec.servers).toEqual([{ url: "https://pets.example" }]);
  });
});
