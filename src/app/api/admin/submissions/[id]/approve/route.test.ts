import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/sitemap-cache", () => ({
  revalidateSitemapCache: vi.fn(),
}));

import { POST } from "@/app/api/admin/submissions/[id]/approve/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import { moderatePet } from "@/lib/pets/repository";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

describe("POST /api/admin/submissions/[id]/approve", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INDEXNOW_KEY", "indexnow-key-123");
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
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
  });

  it("does not revalidate sitemap cache when the pet is missing", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(moderatePet).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(404);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
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
    expect(revalidateSitemapCache).toHaveBeenCalledTimes(1);
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
      status: "submitted",
      httpStatus: 200,
      urlCount: 1,
    });
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("pets.example");
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("indexnow-key-123");

    infoSpy.mockRestore();
  });

  it("logs failed IndexNow submissions without sensitive request data", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      status: "failed",
      httpStatus: 429,
      error: `IndexNow rejected https://pets.example/pets/boba with ${process.env.INDEXNOW_KEY}`,
      urls: ["https://pets.example/pets/boba"],
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith("[codex-pets][indexnow]", {
      slug: "boba",
      status: "failed",
      httpStatus: 429,
      error: "request_failed",
      urlCount: 1,
    });
    const logPayload = JSON.stringify(warnSpy.mock.calls);
    expect(logPayload).not.toContain("pets.example");
    expect(logPayload).not.toContain("indexnow-key-123");

    warnSpy.mockRestore();
  });

  it("logs a null HTTP status when IndexNow fails before receiving a response", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
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
      status: "failed",
      error: "fetch failed",
      urls: ["https://pets.example/pets/boba"],
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith("[codex-pets][indexnow]", {
      slug: "boba",
      status: "failed",
      httpStatus: null,
      error: "request_failed",
      urlCount: 1,
    });
    const logPayload = JSON.stringify(warnSpy.mock.calls);
    expect(logPayload).not.toContain("pets.example");
    expect(logPayload).not.toContain("indexnow-key-123");
    expect(logPayload).not.toContain("fetch failed");

    warnSpy.mockRestore();
  });

  it("logs skipped IndexNow submissions without sensitive request data", async () => {
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
      status: "skipped",
      reason: "missing-key",
      urls: ["https://pets.example/pets/boba"],
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(infoSpy).toHaveBeenCalledWith("[codex-pets][indexnow]", {
      slug: "boba",
      status: "skipped",
      reason: "missing-key",
    });
    const logPayload = JSON.stringify(infoSpy.mock.calls);
    expect(logPayload).not.toContain("pets.example");
    expect(logPayload).not.toContain("indexnow-key-123");

    infoSpy.mockRestore();
  });
});
