import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pets/repository", () => ({
  getApprovedPetBySlug: vi.fn(),
  incrementDownload: vi.fn(),
}));

import { GET } from "@/app/api/pets/[slug]/download/route";
import { getApprovedPetBySlug, incrementDownload } from "@/lib/pets/repository";

describe("GET /api/pets/[slug]/download", () => {
  it("returns 404 for missing pets", async () => {
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
  });

  it("redirects to the zip and increments metrics", async () => {
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
      downloadCount: 0,
      likeCount: 0,
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "boba" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://assets/pets/boba.zip");
    expect(incrementDownload).toHaveBeenCalledWith("boba");
  });
});
