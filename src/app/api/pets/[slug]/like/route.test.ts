import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pets/repository", () => ({
  getApprovedPetBySlug: vi.fn(),
  incrementLike: vi.fn(),
}));

import { POST } from "@/app/api/pets/[slug]/like/route";
import { getApprovedPetBySlug, incrementLike } from "@/lib/pets/repository";

describe("POST /api/pets/[slug]/like", () => {
  it("returns 404 for missing pets", async () => {
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(incrementLike).not.toHaveBeenCalled();
  });

  it("increments likes for approved pets", async () => {
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce({
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
      createdAt: new Date().toISOString(),
      approvedAt: new Date().toISOString(),
      downloadCount: 3,
      likeCount: 6,
    });
    vi.mocked(incrementLike).mockResolvedValueOnce(7);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "boba" }),
    });

    await expect(response.json()).resolves.toEqual({ likeCount: 7 });
    expect(incrementLike).toHaveBeenCalledWith("boba");
  });
});
