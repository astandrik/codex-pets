import { beforeEach, describe, expect, it, vi } from "vitest";

describe("GET /openapi.json", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("serves the canonical OpenAPI JSON document", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { GET } = await import("@/app/openapi.json/route");
    const response = GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600",
    );
    expect(body.openapi).toBe("3.1.0");
    expect(body.info.title).toBe("Codex Pets API");
    expect(body.paths).toHaveProperty("/api/manifest");
  });

  it("serves the same document from /api/openapi.json", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { GET: getCanonical } = await import("@/app/openapi.json/route");
    const { GET: getAlias } = await import("@/app/api/openapi.json/route");

    await expect(getAlias().json()).resolves.toEqual(
      await getCanonical().json(),
    );
  });
});
