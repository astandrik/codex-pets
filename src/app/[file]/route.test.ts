import { afterEach, describe, expect, it, vi } from "vitest";

describe("GET /[file]", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("serves the configured IndexNow key file", async () => {
    vi.resetModules();
    vi.stubEnv("INDEXNOW_KEY", "indexnow-key-123");

    const { GET } = await import("@/app/[file]/route");
    const response = await GET(new Request("https://pets.example/indexnow-key-123.txt"), {
      params: Promise.resolve({ file: "indexnow-key-123.txt" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/plain");
    expect(await response.text()).toBe("indexnow-key-123");
  });

  it("returns 404 for non-key root files", async () => {
    vi.resetModules();
    vi.stubEnv("INDEXNOW_KEY", "indexnow-key-123");

    const { GET } = await import("@/app/[file]/route");
    const response = await GET(new Request("https://pets.example/random.txt"), {
      params: Promise.resolve({ file: "random.txt" }),
    });

    expect(response.status).toBe(404);
  });
});
