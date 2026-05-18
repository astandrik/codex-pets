import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  moderatePet: vi.fn(),
}));

vi.mock("@/lib/indexnow", () => ({
  notifyIndexNowOfApprovedPet: vi.fn(),
}));

import { POST } from "@/app/api/admin/submissions/[id]/approve/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import { moderatePet } from "@/lib/pets/repository";

describe("POST /api/admin/submissions/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notifyIndexNowOfApprovedPet).mockResolvedValue({
      status: "skipped",
      reason: "missing-key",
      urls: [],
    });
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
    expect(notifyIndexNowOfApprovedPet).not.toHaveBeenCalled();
  });

  it("approves a pending pet for admins", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(moderatePet).mockResolvedValueOnce({
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
      installCount: 0,
      likeCount: 0,
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(notifyIndexNowOfApprovedPet).toHaveBeenCalledWith("boba");
  });

  it("logs successful IndexNow submissions without URL payloads", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(moderatePet).mockResolvedValueOnce({
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
      installCount: 0,
      likeCount: 0,
    });
    vi.mocked(notifyIndexNowOfApprovedPet).mockResolvedValueOnce({
      status: "submitted",
      httpStatus: 200,
      urls: ["https://pets.example/pets/boba"],
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith("[codex-pets][indexnow]", {
      slug: "boba",
      httpStatus: 200,
      urlCount: 1,
    });
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("pets.example");

    infoSpy.mockRestore();
  });
});
