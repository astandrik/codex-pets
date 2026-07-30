import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  softDeletePetById: vi.fn(),
}));

vi.mock("@/lib/sitemap-cache", () => ({
  revalidateSitemapCache: vi.fn(),
}));

vi.mock("@/lib/pets/related-pets-server", () => ({
  revalidateRelatedPetCandidatesCache: vi.fn(),
}));

import { POST } from "@/app/api/admin/submissions/[id]/delete/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { softDeletePetById } from "@/lib/pets/repository";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

describe("POST /api/admin/submissions/[id]/delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-admin requests", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user_1",
      email: null,
      name: null,
      role: "user",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(false);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(403);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
    expect(revalidateRelatedPetCandidatesCache).not.toHaveBeenCalled();
  });

  it("allows admins to delete any pet", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(softDeletePetById).mockResolvedValueOnce(true);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(softDeletePetById).toHaveBeenCalledWith({
      petId: "pet_1",
      actorUserId: "admin_1",
      actorRole: "admin",
    });
    expect(revalidateSitemapCache).toHaveBeenCalledTimes(1);
    expect(revalidateRelatedPetCandidatesCache).toHaveBeenCalledTimes(1);
  });

  it("does not revalidate sitemap cache when the pet is missing", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(softDeletePetById).mockResolvedValueOnce(false);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(404);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
    expect(revalidateRelatedPetCandidatesCache).not.toHaveBeenCalled();
  });
});
