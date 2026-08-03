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

vi.mock("@/lib/pets/search-provider-runtime", () => ({
  petSearchRuntimeConfig: {
    semantic: null,
  },
}));

vi.mock("@/lib/pets/related-pets-rebuild", () => ({
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
import { moderatePet } from "@/lib/pets/repository";
import { rebuildRelatedPets } from "@/lib/pets/related-pets-rebuild";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import { petSearchRuntimeConfig } from "@/lib/pets/search-provider-runtime";
import { refreshApprovedPetSearchEmbedding } from "@/lib/pets/search-runtime";
import { refreshApprovedPetVisionSearchBestEffort } from "@/lib/pets/search-vision-runtime";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

function currentRelatedPetsSemanticConfig() {
  return {
    folderId: "folder-id",
    apiKey: "api-key",
    revision: "yandex-text-embeddings-v2-768-2026-07" as const,
    embeddingModelId: "yandex-text-embeddings-v2-768" as const,
    dimensions: 768,
    minSemanticScore: 0.28,
    timeoutMs: 800,
  };
}

describe("POST /api/admin/submissions/[id]/approve", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    petSearchRuntimeConfig.semantic = currentRelatedPetsSemanticConfig();
    vi.stubEnv("INDEXNOW_KEY", "indexnow-key-123");
    vi.mocked(notifyIndexNowOfApprovedPet).mockResolvedValue({
      status: "skipped",
      reason: "missing-key",
      urls: [],
    });
    vi.mocked(rebuildRelatedPets).mockResolvedValue({
      operation: "apply",
      status: "ready",
      generationId: "generation-1",
      rankingRevision: "related-pets-hybrid-rrf-v1",
      coverage: {
        approvedPetCount: 1,
        snapshotCount: 1,
        textVectorCount: 1,
        visualVectorCount: 0,
      },
      rankings: [{ sourceSlug: "boba", relatedSlugs: [] }],
      durationMs: 1,
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

  it("preserves compatible stored visual rankings in the immediate approval rebuild", async () => {
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
    expect(rebuildRelatedPets).toHaveBeenCalledWith({
      mode: "apply",
      includeVisual: true,
    });
    expect(refreshApprovedPetVisionSearchBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({ slug: "boba", status: "approved" }),
      { onSuccessfulRefresh: expect.any(Function) },
    );
  });

  it("starts a separately logged best-effort rebuild after successful asynchronous visual indexing", async () => {
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
    vi.mocked(refreshApprovedPetVisionSearchBestEffort).mockImplementationOnce(
      async (_pet, options) => {
        await options?.onSuccessfulRefresh?.("caption-and-vector");
        return true;
      },
    );
    vi.mocked(rebuildRelatedPets)
      .mockResolvedValueOnce({
        operation: "apply",
        status: "ready",
        generationId: "generation-1",
        rankingRevision: "related-pets-hybrid-rrf-v1",
        coverage: {
          approvedPetCount: 1,
          snapshotCount: 1,
          textVectorCount: 1,
          visualVectorCount: 0,
        },
        rankings: [{ sourceSlug: "boba", relatedSlugs: [] }],
        durationMs: 1,
      })
      .mockRejectedValueOnce(new Error("private visual rebuild detail"));

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(rebuildRelatedPets).toHaveBeenCalledTimes(2));
    expect(rebuildRelatedPets).toHaveBeenNthCalledWith(1, {
      mode: "apply",
      includeVisual: true,
    });
    expect(rebuildRelatedPets).toHaveBeenNthCalledWith(2, {
      mode: "apply",
      includeVisual: true,
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "[codex-pets][related-pets-rebuild-trigger]",
      {
        operation: "rebuild",
        trigger: "approve-visual",
        status: "failed",
        includeVisual: true,
      },
    );
    expect(warnSpy).not.toHaveBeenCalledWith(
      "[codex-pets][pet-vision-search]",
      expect.anything(),
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "private visual rebuild detail",
    );
    warnSpy.mockRestore();
  });

  it("does not publish related snapshots when text indexing uses an incompatible profile", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    petSearchRuntimeConfig.semantic = {
      folderId: "folder-id",
      apiKey: "api-key",
      revision: "yandex-text-search-2026-07",
      embeddingModelId: "yandex-text-search-v1-256",
      dimensions: 256,
      minSemanticScore: 0.31,
      timeoutMs: 800,
    };
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
    expect(refreshApprovedPetSearchEmbedding).toHaveBeenCalledOnce();
    await vi.waitFor(() =>
      expect(refreshApprovedPetVisionSearchBestEffort).toHaveBeenCalledOnce(),
    );
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[codex-pets][related-pets-rebuild-trigger]",
      {
        operation: "rebuild",
        trigger: "approve-text",
        status: "skipped",
        reason: "text-profile-incompatible",
      },
    );
    warnSpy.mockRestore();
  });

  it("awaits text indexing before the immediate rebuild and response work", async () => {
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
    let finishRebuild: (() => void) | undefined;
    vi.mocked(rebuildRelatedPets).mockReturnValueOnce(
      new Promise((resolve) => {
        finishRebuild = () =>
          resolve({
            operation: "apply",
            status: "ready",
            generationId: "generation-1",
            rankingRevision: "related-pets-hybrid-rrf-v1",
            coverage: {
              approvedPetCount: 1,
              snapshotCount: 1,
              textVectorCount: 1,
              visualVectorCount: 0,
            },
            rankings: [{ sourceSlug: "boba", relatedSlugs: [] }],
            durationMs: 1,
          });
      }),
    );

    const responsePromise = POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    await vi.waitFor(() =>
      expect(refreshApprovedPetSearchEmbedding).toHaveBeenCalledTimes(1),
    );
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
    expect(notifyIndexNowOfApprovedPet).not.toHaveBeenCalled();

    finishTextIndexing?.();
    await vi.waitFor(() => expect(rebuildRelatedPets).toHaveBeenCalledTimes(1));
    expect(notifyIndexNowOfApprovedPet).not.toHaveBeenCalled();

    finishRebuild?.();
    const response = await responsePromise;
    expect(response.status).toBe(200);
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
    expect(notifyIndexNowOfApprovedPet).toHaveBeenCalledWith("boba");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("provider failed");
    warnSpy.mockRestore();
  });

  it("keeps approval successful when text indexing and the immediate rebuild fail independently", async () => {
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
    vi.mocked(refreshApprovedPetSearchEmbedding).mockRejectedValueOnce(
      new Error("text provider secret"),
    );
    vi.mocked(rebuildRelatedPets).mockRejectedValueOnce(
      new Error("snapshot storage secret"),
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(rebuildRelatedPets).toHaveBeenCalledWith({
      mode: "apply",
      includeVisual: true,
    });
    expect(refreshApprovedPetVisionSearchBestEffort).toHaveBeenCalledTimes(1);
    expect(notifyIndexNowOfApprovedPet).toHaveBeenCalledWith("boba");
    expect(warnSpy).toHaveBeenCalledWith("[codex-pets][pet-search-embedding]", {
      operation: "refresh",
      status: "failed",
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "[codex-pets][related-pets-rebuild-trigger]",
      {
        operation: "rebuild",
        trigger: "approve-text",
        status: "failed",
        includeVisual: true,
      },
    );
    const logPayload = JSON.stringify(warnSpy.mock.calls);
    expect(logPayload).not.toContain("text provider secret");
    expect(logPayload).not.toContain("snapshot storage secret");
    warnSpy.mockRestore();
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
