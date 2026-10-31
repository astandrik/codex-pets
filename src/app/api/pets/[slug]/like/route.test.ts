import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pets/repository", () => ({
  getApprovedPetBySlug: vi.fn(),
  incrementLike: vi.fn(),
}));

import { POST } from "@/app/api/pets/[slug]/like/route";
import { getApprovedPetBySlug, incrementLike } from "@/lib/pets/repository";

const approvedPet = {
  id: "pet_1",
  slug: "boba",
  displayName: "Boba",
  description: "desc",
  spritesheetUrl: "https://assets/pets/boba.webp",
  petJsonUrl: "https://assets/pets/boba.json",
  zipUrl: "https://assets/pets/boba.zip",
  spritesheetExt: "webp",
  kind: "creature",
  tags: [],
  status: "approved",
  ownerName: "user",
  contactEmail: null,
  createdAt: "2026-10-31T00:00:00.000Z",
  approvedAt: "2026-10-31T00:00:00.000Z",
  downloadCount: 3,
  installCount: 2,
  likeCount: 6,
} satisfies NonNullable<Awaited<ReturnType<typeof getApprovedPetBySlug>>>;

describe("POST /api/pets/[slug]/like", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/pets-base");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 404 for missing pets", async () => {
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(incrementLike).not.toHaveBeenCalled();
  });

  it("increments likes for approved pets", async () => {
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce(approvedPet);
    vi.mocked(incrementLike).mockResolvedValueOnce(7);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "boba" }),
    });

    await expect(response.json()).resolves.toEqual({ likeCount: 7 });
    expect(incrementLike).toHaveBeenCalledWith("boba");
  });

  it.each<Record<string, string>>([
    { origin: "https://untrusted.example" },
    { origin: "null" },
    { origin: "not a URL" },
    { origin: "" },
    { origin: "https://pets.example.evil.test" },
    { origin: "http://pets.example" },
    { origin: "https://pets.example:8443" },
    { origin: "https://pets.example/path" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { origin: "https://pets.example", "sec-fetch-site": "cross-site" },
    { referer: "https://untrusted.example/page" },
    { referer: "not a URL" },
  ])("rejects untrusted browser headers before database access: %j", async (headers) => {
    const response = await POST(new Request("http://internal:3000/api/pets/boba/like", {
      method: "POST", headers,
    }), { params: Promise.resolve({ slug: "boba" }) });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: "invalid_origin" });
    expect(getApprovedPetBySlug).not.toHaveBeenCalled();
    expect(incrementLike).not.toHaveBeenCalled();
  });

  it.each<Record<string, string>>([
    {},
    { origin: "https://pets.example", "sec-fetch-site": "same-origin" },
    { referer: "https://pets.example/pets-base/", "sec-fetch-site": "same-origin" },
    { "sec-fetch-site": "none" },
  ])("preserves anonymous likes without cookies: %j", async (headers) => {
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce(approvedPet);
    vi.mocked(incrementLike).mockResolvedValueOnce(8);
    const request = new Request("http://internal:3000/api/pets/boba/like", {
      method: "POST", headers,
    });
    expect(request.headers.has("cookie")).toBe(false);

    const response = await POST(request, { params: Promise.resolve({ slug: "boba" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ likeCount: 8 });
    expect(incrementLike).toHaveBeenCalledExactlyOnceWith("boba");
  });

  it("uses the request origin when no public URL is configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce(null);
    const response = await POST(new Request("http://localhost:4321/api/pets/missing/like", {
      method: "POST", headers: { origin: "http://localhost:4321", "sec-fetch-site": "same-origin" },
    }), { params: Promise.resolve({ slug: "missing" }) });

    expect(response.status).toBe(404);
    expect(getApprovedPetBySlug).toHaveBeenCalledExactlyOnceWith("missing");
    expect(incrementLike).not.toHaveBeenCalled();
  });
});
