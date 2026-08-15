import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  softDeletePetByIdWithPreviousStatus: vi.fn(),
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

import { POST } from "@/app/api/my-pets/[id]/delete/route";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { softDeletePetByIdWithPreviousStatus } from "@/lib/pets/repository";
import { rebuildRelatedPets } from "@/lib/pets/related-pets-rebuild";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

describe("POST /api/my-pets/[id]/delete", () => {
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
      rankings: [],
      durationMs: 1,
    });
  });

  it("rejects anonymous requests", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(401);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
    expect(revalidateRelatedPetCandidatesCache).not.toHaveBeenCalled();
  });

  it("deletes only owner-owned pets", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(softDeletePetByIdWithPreviousStatus).mockResolvedValueOnce({
      previousStatus: "approved",
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(softDeletePetByIdWithPreviousStatus).toHaveBeenCalledWith({
      petId: "pet_1",
      actorUserId: "user@example.com",
      actorRole: "user",
    });
    expect(revalidateSitemapCache).toHaveBeenCalledTimes(1);
    expect(revalidateRelatedPetCandidatesCache).toHaveBeenCalledTimes(1);
    expect(rebuildRelatedPets).toHaveBeenCalledWith({
      mode: "apply",
      includeVisual: true,
    });
  });

  it("awaits the full rebuild and preserves deletion on rebuild failure", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(softDeletePetByIdWithPreviousStatus).mockResolvedValueOnce({
      previousStatus: "approved",
    });
    let rejectRebuild: ((error: Error) => void) | undefined;
    vi.mocked(rebuildRelatedPets).mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectRebuild = reject;
      }),
    );

    const responsePromise = POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });
    await vi.waitFor(() => expect(rebuildRelatedPets).toHaveBeenCalledTimes(1));
    let settled = false;
    void responsePromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    rejectRebuild?.(new Error("private owner-delete failure"));
    expect((await responsePromise).status).toBe(200);
    expect(warnSpy).toHaveBeenCalledWith(
      "[codex-pets][related-pets-rebuild-trigger]",
      {
        operation: "rebuild",
        trigger: "owner-delete",
        status: "failed",
        includeVisual: true,
      },
    );
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(
      "private owner-delete failure",
    );
    warnSpy.mockRestore();
  });

  it("does not rebuild related pets after deleting a pending pet", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(softDeletePetByIdWithPreviousStatus).mockResolvedValueOnce({
      previousStatus: "pending",
    });

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(200);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
    expect(revalidateRelatedPetCandidatesCache).not.toHaveBeenCalled();
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
  });

  it("does not revalidate sitemap cache when the pet is missing", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(softDeletePetByIdWithPreviousStatus).mockResolvedValueOnce(null);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "pet_1" }),
    });

    expect(response.status).toBe(404);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
    expect(revalidateRelatedPetCandidatesCache).not.toHaveBeenCalled();
    expect(rebuildRelatedPets).not.toHaveBeenCalled();
  });
});
