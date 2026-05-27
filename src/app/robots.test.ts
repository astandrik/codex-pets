import { describe, expect, it, vi } from "vitest";

describe("robots", () => {
  it("allows public developer and agent resource routes while disallowing admin routes", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");

    const { default: robots } = await import("@/app/robots");
    const result = robots();
    const firstRule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

    expect(firstRule.allow).toEqual(
      expect.arrayContaining([
        "/codex-pets/agents",
        "/codex-pets/agents.md",
        "/codex-pets/developers",
        "/codex-pets/developers/llms.txt",
        "/codex-pets/docs/api",
        "/codex-pets/docs/llms.txt",
        "/codex-pets/guides/",
        "/codex-pets/llms-full.txt",
        "/codex-pets/openapi.json",
        "/codex-pets/index.md",
        "/codex-pets/about.md",
        "/codex-pets/developers.md",
        "/codex-pets/docs/api.md",
        "/codex-pets/mcp.md",
        "/codex-pets/auth.md",
        "/codex-pets/.well-known/mcp",
        "/codex-pets/.well-known/mcp/server-card.json",
      ]),
    );
    expect(firstRule.disallow).toEqual(
      expect.arrayContaining(["/codex-pets/admin", "/codex-pets/api/admin"]),
    );
    expect(result.sitemap).toBe("https://pets.example/codex-pets/sitemap.xml");

    vi.unstubAllEnvs();
  });
});
