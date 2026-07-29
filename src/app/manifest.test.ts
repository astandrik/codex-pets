import { afterEach, describe, expect, it, vi } from "vitest";

describe("web manifest", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("exposes site identity, start url, scope, and brand icons", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { default: manifest } = await import("@/app/manifest");
    const { withBasePath } = await import("@/lib/base-path");
    const { SITE_NAME } = await import("@/lib/site-metadata");

    const data = manifest();

    expect(data.name).toContain(SITE_NAME);
    expect(data.start_url).toBe(withBasePath("/"));
    expect(data.scope).toBe(withBasePath("/"));
    expect(data.display).toBe("standalone");

    const icons = (data.icons ?? []).map((icon) => `${icon.sizes}:${icon.src}`);
    expect(icons).toContain(`any:${withBasePath("/favicon.svg")}`);
    expect(icons).toContain(`192x192:${withBasePath("/assets/brand-icon-192.png")}`);
    expect(icons).toContain(`512x512:${withBasePath("/assets/brand-icon-512.png")}`);
  });

  it("keeps start_url inside an explicit scope under a base path", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { default: manifest } = await import("@/app/manifest");

    const data = manifest();

    expect(data.start_url).toBe("/codex-pets/");
    expect(data.scope).toBe("/codex-pets/");
  });
});
