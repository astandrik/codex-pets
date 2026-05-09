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
    expect(withBasePath("/codex-pets/api/pets")).toBe("/codex-pets/api/pets");

    vi.unstubAllEnvs();
  });
});
