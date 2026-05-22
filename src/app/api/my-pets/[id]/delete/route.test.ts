import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  softDeletePetById: vi.fn(),
}));

vi.mock("@/lib/sitemap-cache", () => ({
  revalidateSitemapCache: vi.fn(),
}));

import { POST } from "@/app/api/my-pets/[id]/delete/route";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { softDeletePetById } from "@/lib/pets/repository";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

describe("POST /api/my-pets/[id]/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects anonymous requests", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(401);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
  });

  it("deletes only owner-owned pets", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(softDeletePetById).mockResolvedValueOnce(true);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(softDeletePetById).toHaveBeenCalledWith({
      petId: "pet_1",
      actorUserId: "user@example.com",
      actorRole: "user",
    });
    expect(revalidateSitemapCache).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate sitemap cache when the pet is missing", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(softDeletePetById).mockResolvedValueOnce(false);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(404);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
  });
});
