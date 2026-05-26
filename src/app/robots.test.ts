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
        "/codex-pets/developers",
        "/codex-pets/docs/api",
        "/codex-pets/guides/",
        "/codex-pets/llms-full.txt",
        "/codex-pets/openapi.json",
      ]),
    );
    expect(firstRule.disallow).toEqual(
      expect.arrayContaining(["/codex-pets/admin", "/codex-pets/api/admin"]),
    );
    expect(result.sitemap).toBe("https://pets.example/codex-pets/sitemap.xml");

    vi.unstubAllEnvs();
  });
});
