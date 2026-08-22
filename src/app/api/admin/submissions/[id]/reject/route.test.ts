import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  moderatePetWithPreviousStatus: vi.fn(),
}));

vi.mock("@/lib/pets/search-provider-runtime", () => ({
  petSearchRuntimeConfig: {
    semantic: {
      revision: "yandex-text-embeddings-v2-768-2026-07",
      dimensions: 768,
    },
  },
}));

vi.mock("@/lib/pets/related-pets-rebuild", () => ({
  invalidateRelatedPets: vi.fn(),
  rebuildRelatedPets: vi.fn(),
}));

vi.mock("@/lib/sitemap-cache", () => ({
  revalidateSitemapCache: vi.fn(),
}));

vi.mock("@/lib/pets/related-pets-server", () => ({
  revalidateRelatedPetCandidatesCache: vi.fn(),
}));

import { POST } from "@/app/api/admin/submissions/[id]/reject/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { moderatePetWithPreviousStatus } from "@/lib/pets/repository";
import { rebuildRelatedPets } from "@/lib/pets/related-pets-rebuild";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

function rejectedModeration(previousStatus: "pending" | "approved") {
  return {
    previousStatus,
    pet: {
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
      status: "rejected" as const,
      ownerName: "user",
      contactEmail: null,
      createdAt: new Date().toISOString(),
      approvedAt:
        previousStatus === "approved" ? new Date().toISOString() : null,
      downloadCount: 0,
      installCount: 0,
      likeCount: 0,
    },
  };
}

describe("POST /api/admin/submissions/[id]/reject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(rebuildRelatedPets).mockResolvedValue({
      operation: "apply",
      status: "ready",
      generationId: "generation-1",
      rankingRevision: "related-pets-hybrid-rrf-v1",
      coverage: {
        approvedPetCount: 1,
        snapshotCount: 1,
        textVectorCount: 1,
        annotationCount: 1,
        annotationVectorCount: 1,
        visualVectorCount: 1,
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
    vi.mocked(moderatePetWithPreviousStatus).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(404);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
    expect(revalidateRelatedPetCandidatesCache).not.toHaveBeenCalled();
  });

  it("revalidates sitemap cache after a successful rejection", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(moderatePetWithPreviousStatus).mockResolvedValueOnce(
      rejectedModeration("approved"),
    );

    const response = await POST(
      new Request("http://localhost", {
        method: "POST",
        body: JSON.stringify({ reason: "not ready" }),
      }),
      {
        params: Promise.resolve({ id: "pet_1" }),
      },
    );

    expect(response.status).toBe(200);
    expect(revalidateSitemapCache).toHaveBeenCalledTimes(1);
    expect(revalidateRelatedPetCandidatesCache).toHaveBeenCalledTimes(1);
    expect(rebuildRelatedPets).toHaveBeenCalledWith({
      mode: "apply",
      includeVisual: true,
    });
  });

  it("does not rebuild related snapshots when rejecting a pending pet", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(moderatePetWithPreviousStatus).mockResolvedValueOnce(
      rejectedModeration("pending"),
    );

    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "pet_1" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      pet: { slug: "boba", status: "rejected" },
    });
    expect(payload.pet).not.toHaveProperty("previousStatus");
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
  });

  it("awaits the full rebuild after rejection", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(moderatePetWithPreviousStatus).mockResolvedValueOnce(
      rejectedModeration("approved"),
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
              annotationCount: 1,
              annotationVectorCount: 1,
              visualVectorCount: 1,
            },
            rankings: [{ sourceSlug: "boba", relatedSlugs: [] }],
            durationMs: 1,
          });
      }),
    );

    const responsePromise = POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "pet_1" }) },
    );
    await vi.waitFor(() => expect(rebuildRelatedPets).toHaveBeenCalledTimes(1));
    let settled = false;
    void responsePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finishRebuild?.();
    expect((await responsePromise).status).toBe(200);
  });

  it("keeps rejection successful when the full rebuild fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(moderatePetWithPreviousStatus).mockResolvedValueOnce(
      rejectedModeration("approved"),
    );
    vi.mocked(rebuildRelatedPets).mockRejectedValueOnce(
      new Error("private storage detail"),
    );

    const response = await POST(
      new Request("http://localhost", { method: "POST" }),
      { params: Promise.resolve({ id: "pet_1" }) },
    );

    expect(response.status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      "[codex-pets][related-pets-rebuild-trigger]",
      {
        operation: "rebuild",
        trigger: "reject",
        status: "failed",
        includeVisual: true,
      },
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "private storage detail",
    );
    warnSpy.mockRestore();
  });
});
