import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /api/indexnow", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("serves the configured IndexNow key", async () => {
    vi.resetModules();
    vi.stubEnv("INDEXNOW_KEY", "indexnow-key-123");

    const { GET } = await import("@/app/api/indexnow/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("indexnow-key-123");
  });

  it("returns 404 when the IndexNow key is not configured", async () => {
    vi.resetModules();

    const { GET } = await import("@/app/api/indexnow/route");
    const response = await GET();

    expect(response.status).toBe(404);
  });
});
