import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  moderatePet: vi.fn(),
}));

vi.mock("@/lib/pets/search-runtime", () => ({
  refreshApprovedPetSearchEmbedding: vi.fn(),
}));

vi.mock("@/lib/pets/related-pets-query-runtime", () => ({
  refreshApprovedPetRelatedDescriptionEmbeddings: vi.fn(),
}));

vi.mock("@/lib/pets/related-pets-annotation-runtime", () => ({
  refreshPetRelatedAnnotation: vi.fn(),
}));

vi.mock("@/lib/pets/related-pets-rebuild", () => ({
  invalidateRelatedPets: vi.fn(),
  rebuildRelatedPets: vi.fn(),
}));

vi.mock("@/lib/pets/search-vision-runtime", () => ({
  refreshApprovedPetVisionSearchBestEffort: vi.fn(async () => true),
}));

vi.mock("@/lib/indexnow", () => ({
  notifyIndexNowOfApprovedPet: vi.fn(),
}));

vi.mock("@/lib/sitemap-cache", () => ({
  revalidateSitemapCache: vi.fn(),
}));

vi.mock("@/lib/pets/related-pets-server", () => ({
  revalidateRelatedPetCandidatesCache: vi.fn(),
}));

import { POST } from "@/app/api/admin/submissions/[id]/approve/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import { refreshPetRelatedAnnotation } from "@/lib/pets/related-pets-annotation-runtime";
import { moderatePet } from "@/lib/pets/repository";
import { refreshApprovedPetRelatedDescriptionEmbeddings } from "@/lib/pets/related-pets-query-runtime";
import {
  invalidateRelatedPets,
  rebuildRelatedPets,
} from "@/lib/pets/related-pets-rebuild";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import { refreshApprovedPetSearchEmbedding } from "@/lib/pets/search-runtime";
import { refreshApprovedPetVisionSearchBestEffort } from "@/lib/pets/search-vision-runtime";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

function approvedPet() {
  return {
    id: "pet_1",
    slug: "boba",
    displayName: "Boba",
    description: "desc",
    spritesheetUrl: "/api/assets/asset-123/spritesheet.webp",
    petJsonUrl: "/api/assets/asset-123/pet.json",
    zipUrl: "/api/assets/asset-123/pet.zip",
    spritesheetExt: "webp" as const,
    kind: "creature" as const,
    tags: [],
    status: "approved" as const,
    ownerName: "user",
    contactEmail: null,
    createdAt: "2026-08-21T00:00:00.000Z",
    approvedAt: "2026-08-21T00:00:00.000Z",
    downloadCount: 0,
    installCount: 0,
    likeCount: 0,
  };
}

describe("POST /api/admin/submissions/[id]/approve", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(refreshApprovedPetSearchEmbedding).mockResolvedValue("updated");
    vi.mocked(refreshApprovedPetRelatedDescriptionEmbeddings).mockResolvedValue({
      descriptionQuery: "updated",
      descriptionDocument: "updated",
    });
    vi.mocked(refreshPetRelatedAnnotation).mockResolvedValue("unchanged");
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
    expect(revalidateRelatedPetCandidatesCache).not.toHaveBeenCalled();
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
    expect(revalidateRelatedPetCandidatesCache).not.toHaveBeenCalled();
    expect(notifyIndexNowOfApprovedPet).not.toHaveBeenCalled();
  });

  it("keeps durable V24 preparation out of the approval request", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(moderatePet).mockResolvedValueOnce(approvedPet());
    vi.mocked(refreshPetRelatedAnnotation).mockReturnValueOnce(
      new Promise(() => undefined),
    );

    const response = await Promise.race([
      POST(new Request("http://localhost"), {
        params: Promise.resolve({ id: "pet_1" }),
      }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("approval waited for annotation")),
          50,
        ),
      ),
    ]);

    expect(response.status).toBe(200);
    expect(refreshPetRelatedAnnotation).not.toHaveBeenCalled();
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
    expect(invalidateRelatedPets).not.toHaveBeenCalled();
    expect(refreshApprovedPetSearchEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "boba", status: "approved" }),
    );
    expect(refreshApprovedPetRelatedDescriptionEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "boba", status: "approved" }),
    );
    expect(refreshApprovedPetVisionSearchBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "boba", status: "approved" }),
    );
  });

  it("starts visual indexing without a related rebuild callback", async () => {
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
    expect(revalidateRelatedPetCandidatesCache).toHaveBeenCalledTimes(1);
    expect(notifyIndexNowOfApprovedPet).toHaveBeenCalledWith("boba");
    expect(refreshApprovedPetSearchEmbedding).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "boba", status: "approved" }),
    );
    expect(refreshApprovedPetRelatedDescriptionEmbeddings).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "boba", status: "approved" }),
    );
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
    expect(refreshApprovedPetVisionSearchBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "boba", status: "approved" }),
    );
  });

  it("awaits both text vectors before starting visual indexing", async () => {
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
      spritesheetUrl: "/api/assets/asset-123/spritesheet.webp",
      petJsonUrl: "/api/assets/asset-123/pet.json",
      zipUrl: "/api/assets/asset-123/pet.zip",
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
    let finishTextIndexing: (() => void) | undefined;
    vi.mocked(refreshApprovedPetSearchEmbedding).mockReturnValueOnce(
      new Promise((resolve) => {
        finishTextIndexing = () => resolve("updated");
      }),
    );
    let finishRelatedIndexing: (() => void) | undefined;
    vi.mocked(refreshApprovedPetRelatedDescriptionEmbeddings).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRelatedIndexing = () => resolve({
          descriptionQuery: "unchanged",
          descriptionDocument: "unchanged",
        });
      }),
    );
    vi.mocked(refreshApprovedPetVisionSearchBestEffort).mockImplementationOnce(
      async (_pet, options) => {
        await options?.onSuccessfulRefresh?.("vector-only");
        return true;
      },
    );

    const responsePromise = POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    await vi.waitFor(() =>
      expect(refreshApprovedPetSearchEmbedding).toHaveBeenCalledTimes(1),
    );
    expect(refreshApprovedPetRelatedDescriptionEmbeddings).toHaveBeenCalledTimes(1);
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
    expect(refreshApprovedPetVisionSearchBestEffort).not.toHaveBeenCalled();
    expect(notifyIndexNowOfApprovedPet).not.toHaveBeenCalled();

    finishTextIndexing?.();
    await Promise.resolve();
    expect(refreshApprovedPetVisionSearchBestEffort).not.toHaveBeenCalled();
    expect(notifyIndexNowOfApprovedPet).not.toHaveBeenCalled();

    finishRelatedIndexing?.();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(refreshApprovedPetVisionSearchBestEffort).toHaveBeenCalledTimes(1);
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
    expect(invalidateRelatedPets).not.toHaveBeenCalled();
    expect(notifyIndexNowOfApprovedPet).toHaveBeenCalledWith("boba");
  });

  it("does not wait for the best-effort visual refresh", async () => {
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
      spritesheetUrl: "/api/assets/asset-123/spritesheet.webp",
      petJsonUrl: "/api/assets/asset-123/pet.json",
      zipUrl: "/api/assets/asset-123/pet.zip",
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
    vi.mocked(refreshApprovedPetSearchEmbedding).mockResolvedValueOnce("updated");
    vi.mocked(refreshApprovedPetVisionSearchBestEffort).mockReturnValueOnce(
      new Promise(() => undefined),
    );

    const response = await Promise.race([
      POST(new Request("http://localhost"), {
        params: Promise.resolve({ id: "pet_1" }),
      }),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("approval waited for vision")), 50),
      ),
    ]);

    expect(response.status).toBe(200);
  });

  it("does not roll back approval when embedding refresh fails", async () => {
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
    vi.mocked(refreshApprovedPetSearchEmbedding).mockRejectedValueOnce(
      new Error("provider failed"),
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(refreshApprovedPetRelatedDescriptionEmbeddings).toHaveBeenCalledOnce();
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
    expect(refreshApprovedPetVisionSearchBestEffort).toHaveBeenCalledOnce();
    expect(notifyIndexNowOfApprovedPet).toHaveBeenCalledWith("boba");
    expect(warnSpy).toHaveBeenCalledWith(
      "[codex-pets][search-document-refresh]",
      {
        operation: "refresh",
        status: "failed",
      },
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider failed");
    warnSpy.mockRestore();
  });

  it("keeps approval successful and skips visual-triggered rebuild when description indexing fails", async () => {
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
      spritesheetUrl: "/api/assets/asset-123/spritesheet.webp",
      petJsonUrl: "/api/assets/asset-123/pet.json",
      zipUrl: "/api/assets/asset-123/pet.zip",
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
    vi.mocked(refreshApprovedPetRelatedDescriptionEmbeddings).mockResolvedValueOnce({
      descriptionQuery: "failed",
      descriptionDocument: "updated",
    });
    vi.mocked(refreshApprovedPetVisionSearchBestEffort).mockImplementationOnce(
      async (_pet, options) => {
        await options?.onSuccessfulRefresh?.("caption-and-vector");
        return true;
      },
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
    expect(refreshApprovedPetVisionSearchBestEffort).toHaveBeenCalledTimes(1);
    expect(notifyIndexNowOfApprovedPet).toHaveBeenCalledWith("boba");
    expect(warnSpy).toHaveBeenCalledWith(
      "[codex-pets][related-pets-v24-refresh]",
      {
        operation: "refresh",
        status: "incomplete",
        descriptionQuery: "failed",
        descriptionDocument: "updated",
      },
    );
    const logPayload = JSON.stringify(warnSpy.mock.calls);
    expect(logPayload).not.toContain("query provider secret");
    warnSpy.mockRestore();
  });

  it("does not publish when a required text refresh is skipped", async () => {
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
      spritesheetUrl: "/api/assets/asset-123/spritesheet.webp",
      petJsonUrl: "/api/assets/asset-123/pet.json",
      zipUrl: "/api/assets/asset-123/pet.zip",
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
    vi.mocked(refreshApprovedPetRelatedDescriptionEmbeddings).mockResolvedValueOnce({
      descriptionQuery: "skipped",
      descriptionDocument: "updated",
    });
    vi.mocked(refreshApprovedPetVisionSearchBestEffort).mockImplementationOnce(
      async (_pet, options) => {
        await options?.onSuccessfulRefresh?.("unchanged");
        return true;
      },
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
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
