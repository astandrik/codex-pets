import { afterEach, describe, expect, it, vi } from "vitest";

describe("IndexNow", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips notifications when INDEXNOW_KEY is not configured", async () => {
    vi.resetModules();
    vi.unstubAllEnvs();

    const { notifyIndexNow } = await import("@/lib/indexnow");
    const result = await notifyIndexNow(["https://pets.example/pets/boba"]);

    expect(result).toEqual({
      status: "skipped",
      reason: "missing-key",
      urls: [],
    });
  });

  it("posts changed approved pet URLs to the configured endpoint", async () => {
    vi.resetModules();
    vi.stubEnv("INDEXNOW_KEY", "indexnow-key-123");
    vi.stubEnv("INDEXNOW_ENDPOINT", "https://indexnow.example/indexnow");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { notifyIndexNowOfApprovedPet } = await import("@/lib/indexnow");
    const result = await notifyIndexNowOfApprovedPet("boba");

    expect(result).toMatchObject({
      status: "submitted",
      httpStatus: 202,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://indexnow.example/indexnow");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      host: "pets.example",
      key: "indexnow-key-123",
      keyLocation: "https://pets.example/codex-pets/indexnow-key-123.txt",
      urlList: [
        "https://pets.example/codex-pets",
        "https://pets.example/codex-pets/pets/boba",
        "https://pets.example/codex-pets/sitemap.xml",
        "https://pets.example/codex-pets/llms.txt",
        "https://pets.example/codex-pets/api/manifest",
      ],
    });
  });
});
