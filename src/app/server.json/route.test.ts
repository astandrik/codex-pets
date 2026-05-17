import { beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /server.json", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns MCP Registry remote server metadata", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    const { GET } = await import("@/app/server.json/route");

    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600",
    );
    expect(body).toEqual({
      $schema:
        "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
      name: "tech.ydb-qdrant.pets/codex-pets-ydb-qdrant",
      title: "Codex Pets Registry",
      description:
        "Search, preview, install community Codex pet packs, and discover the pet request flow.",
      version: "0.2.0",
      websiteUrl: "https://pets.example/",
      remotes: [
        {
          type: "streamable-http",
          url: "https://pets.example/mcp",
        },
      ],
    });
  });

  it("serves the same metadata from the well-known MCP path", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    const { GET: getRoot } = await import("@/app/server.json/route");
    const { GET: getWellKnown } = await import(
      "@/app/.well-known/mcp/server.json/route"
    );

    expect(await getWellKnown().json()).toEqual(await getRoot().json());
  });
});

describe("GET /.well-known/mcp-registry-auth", () => {
  it("returns the public MCP Registry HTTP auth record", async () => {
    const { GET } = await import("@/app/.well-known/mcp-registry-auth/route");

    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/plain; charset=utf-8",
    );
    expect(await response.text()).toBe(
      "v=MCPv1; k=ed25519; p=hf1UAXtYZTedJy3YtpjRYpB6IZRoZKEyzHJ+Wc/uxrc=\n",
    );
  });
});
