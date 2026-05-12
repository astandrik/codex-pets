import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pets/repository", () => ({
  getApprovedPetBySlug: vi.fn(),
  incrementInstall: vi.fn(),
}));

import { POST } from "@/app/api/pets/[slug]/install/route";
import { getApprovedPetBySlug, incrementInstall } from "@/lib/pets/repository";

const approvedPet = {
  id: "pet_1",
  slug: "boba",
  displayName: "Boba",
  description: "desc",
  spritesheetUrl: "https://assets/pets/boba.webp",
  petJsonUrl: "https://assets/pets/boba.json",
  zipUrl: "https://assets/pets/boba.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: [],
  status: "approved" as const,
  ownerName: "user",
  contactEmail: null,
  createdAt: new Date().toISOString(),
  approvedAt: new Date().toISOString(),
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

describe("POST /api/pets/[slug]/install", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 for missing pets", async () => {
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
    expect(incrementInstall).not.toHaveBeenCalled();
  });

  it("increments install metrics for approved pets", async () => {
    vi.mocked(getApprovedPetBySlug).mockResolvedValueOnce(approvedPet);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "boba" }),
    });

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(incrementInstall).toHaveBeenCalledWith("boba");
  });
});
