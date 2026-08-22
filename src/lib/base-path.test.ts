import { describe, expect, it, vi } from "vitest";

describe("withBasePath", () => {
  it("returns the same path when no base path is configured", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();

    const { withBasePath } = await import("@/lib/base-path");
    expect(withBasePath("/submit")).toBe("/submit");
    expect(withBasePath("/api/pets")).toBe("/api/pets");
  });

  it("prefixes paths when NEXT_PUBLIC_BASE_PATH is set", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const { withBasePath } = await import("@/lib/base-path");
    expect(withBasePath("/submit")).toBe("/codex-pets/submit");
    expect(withBasePath("/")).toBe("/codex-pets");
    expect(withBasePath("/?q=red+fox")).toBe("/codex-pets?q=red+fox");
    expect(withBasePath("/codex-pets?q=red+fox")).toBe(
      "/codex-pets?q=red+fox",
    );
    expect(withBasePath("/codex-pets/api/pets")).toBe("/codex-pets/api/pets");

    vi.unstubAllEnvs();
  });

  it("treats a slash-only base path as empty", async () => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "//");

    const { BASE_PATH, withBasePath } = await import("@/lib/base-path");
    expect(BASE_PATH).toBe("");
    expect(withBasePath("/submit")).toBe("/submit");

    vi.unstubAllEnvs();
  });
});

describe("getPublicOrigin", () => {
  it("keeps the localhost fallback for development without configuration", async () => {
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);

    const { getPublicOrigin } = await import("@/lib/base-path");
    expect(getPublicOrigin()).toBe("http://localhost:3000");

    vi.unstubAllEnvs();
  });
});
