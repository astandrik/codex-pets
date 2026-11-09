import { afterEach, describe, expect, it, vi } from "vitest";

// Evaluate prefixes, wildcards and end anchors used by this robots policy.
function allowsPath(path: string, allow: string[], disallow: string[]): boolean {
  const matches = [
    ...allow.map((pattern) => ({ pattern, allowed: true })),
    ...disallow.map((pattern) => ({ pattern, allowed: false })),
  ].filter(({ pattern }) => {
    const anchored = pattern.endsWith("$");
    const source = (anchored ? pattern.slice(0, -1) : pattern)
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
  });
  matches.sort((a, b) => b.pattern.replace(/\$$/, "").length - a.pattern.replace(/\$$/, "").length
    || Number(b.allowed) - Number(a.allowed));
  return matches[0]?.allowed ?? true;
}

describe("robots", () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(["", "/codex-pets"])(
    "allows canonical manifests and idle strips while keeping other API assets blocked for base path %s",
    async (basePath) => {
      vi.resetModules();
      vi.stubEnv("NEXT_PUBLIC_BASE_PATH", basePath);
      const { default: robots } = await import("@/app/robots");
      const result = robots();
      const rules = Array.isArray(result.rules) ? result.rules : [result.rules];

      for (const userAgent of ["*", "OAI-SearchBot", "GPTBot"]) {
        const rule = rules.find((item) => item.userAgent === userAgent);
        expect(rule, userAgent).toBeDefined();
        const allow = [rule?.allow ?? []].flat();
        const disallow = [rule?.disallow ?? []].flat();
        for (const path of [
          "/api/manifest", "/api/manifest.toon",
          "/api/assets/asset_1/idle-strip.webp",
          "/api/assets/asset_a7d5672ff4c5/idle-strip.webp",
        ]) {
          expect(allowsPath(`${basePath}${path}`, allow, disallow), `${userAgent}: ${path}`).toBe(true);
        }
        for (const path of [
          "/api/admin", "/api/pet-generations", "/api/pets", "/api/assets/file",
          "/api/manifest-private", "/api/manifest.toon-private",
          "/api/manifest/child", "/api/manifest.toon/child",
          "/api/manifest?x=1", "/api/manifest.toon?x=1",
          "/api/assets/asset_1/preview.webp", "/api/assets/asset_1/spritesheet.webp",
          "/api/assets/asset_1/spritesheet.png", "/api/assets/asset_1/pet.json",
          "/api/assets/asset_1/pet.zip", "/api/assets/asset_1/idle-strip.webp/child",
          "/api/assets/asset_1/idle-strip.webp?x=1", "/api/assets/asset_1/idle-strip.webp.bak",
          "/api/assets/asset_1/idle-stripXwebp", "/api/admin/asset_1/idle-strip.webp",
        ]) {
          expect(allowsPath(`${basePath}${path}`, allow, disallow), `${userAgent}: ${path}`).toBe(false);
        }
      }
    },
  );

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
        "/codex-pets/pricing",
        "/codex-pets/pricing.md",
        "/codex-pets/terms",
        "/codex-pets/terms.md",
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
        "/codex-pets/.well-known/oauth-protected-resource",
        "/codex-pets/.well-known/oauth-protected-resource/mcp",
      ]),
    );
    expect(firstRule.disallow).toEqual(
      expect.arrayContaining([
        "/codex-pets/admin",
        "/codex-pets/api/admin",
        "/codex-pets/api/",
        "/codex-pets/my-generations",
      ]),
    );
    expect(result.sitemap).toEqual([
      "https://pets.example/codex-pets/sitemap.xml",
      "https://pets.example/codex-pets/sitemap-images.xml",
    ]);
    expect(allowsPath("/codex-pets/pets/boba/preview.webp", [firstRule.allow ?? []].flat(), [firstRule.disallow ?? []].flat())).toBe(true);

    vi.unstubAllEnvs();
  });
});
