import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/pets/approval-preparations-repository", () => ({
  enqueueApprovalPreparation: vi.fn(),
}));

vi.mock("@/lib/pets/related-pets-repository", () => ({
  getRelatedPetsState: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  getPetForApprovalPreparationById: vi.fn(),
}));

import { POST } from "@/app/api/admin/submissions/[id]/approve/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { enqueueApprovalPreparation } from "@/lib/pets/approval-preparations-repository";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-profile";
import { getRelatedPetsState } from "@/lib/pets/related-pets-repository";
import { getPetForApprovalPreparationById } from "@/lib/pets/repository";

const pendingPet = {
  id: "pet_1",
  slug: "tallulah",
  displayName: "Tallulah",
  description: "desc",
  spritesheetUrl: "/api/assets/asset-123/spritesheet.webp",
  petJsonUrl: "/api/assets/asset-123/pet.json",
  zipUrl: "/api/assets/asset-123/pet.zip",
  spritesheetExt: "webp" as const,
  kind: "character" as const,
  tags: [],
  status: "pending" as const,
  ownerName: "user",
  contactEmail: null,
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  approvedAt: null,
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

const readyState = {
  requestedGenerationId: "generation-active",
  activeGenerationId: "generation-active",
  previousGenerationId: "generation-previous",
  status: "ready" as const,
  rankingRevision: RELATED_PETS_V24_PROFILE.rankingRevision,
  failureReason: null,
  updatedAt: "2026-08-11T00:00:00.000Z",
};

const preparation = {
  preparationId: "approval-1",
  petId: pendingPet.id,
  petSlug: pendingPet.slug,
  petUpdatedAt: pendingPet.updatedAt,
  reviewerId: "admin_1",
  rankingRevision: RELATED_PETS_V24_PROFILE.rankingRevision,
  expectedActiveGenerationId: readyState.activeGenerationId,
  preparedGenerationId: "",
  status: "queued" as const,
  attempts: 0,
  nextAttemptAt: pendingPet.updatedAt,
  leaseOwner: "",
  leaseUntil: "",
  failureCode: "",
  createdAt: pendingPet.updatedAt,
  updatedAt: pendingPet.updatedAt,
};

describe("POST /api/admin/submissions/[id]/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PET_RELATED_PREAPPROVAL_ENABLED", "true");
    vi.mocked(getCurrentPrincipal).mockResolvedValue({
      userId: "admin_1",
      email: null,
      name: null,
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValue(true);
    vi.mocked(getPetForApprovalPreparationById).mockResolvedValue(pendingPet);
    vi.mocked(getRelatedPetsState).mockResolvedValue(readyState);
    vi.mocked(enqueueApprovalPreparation).mockResolvedValue(preparation);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects non-admin requests before loading the pet", async () => {
    vi.mocked(isAdminUser).mockReturnValueOnce(false);

    const response = await approve();

    expect(response.status).toBe(403);
    expect(getPetForApprovalPreparationById).not.toHaveBeenCalled();
  });

  it("fails closed when preparation is disabled", async () => {
    vi.stubEnv("PET_RELATED_PREAPPROVAL_ENABLED", "false");

    const response = await approve();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "approval_preparation_required",
    });
    expect(getPetForApprovalPreparationById).not.toHaveBeenCalled();
    expect(enqueueApprovalPreparation).not.toHaveBeenCalled();
  });

  it("rejects missing or non-pending pets", async () => {
    vi.mocked(getPetForApprovalPreparationById).mockResolvedValueOnce(null);
    await expect(approve()).resolves.toMatchObject({ status: 404 });

    vi.mocked(getPetForApprovalPreparationById).mockResolvedValueOnce({
      ...pendingPet,
      status: "approved",
      approvedAt: pendingPet.updatedAt,
    });
    await expect(approve()).resolves.toMatchObject({ status: 404 });
    expect(enqueueApprovalPreparation).not.toHaveBeenCalled();
  });

  it("requires a ready active related generation", async () => {
    vi.mocked(getRelatedPetsState).mockResolvedValueOnce(null);

    const response = await approve();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "related_generation_unavailable",
    });
    expect(enqueueApprovalPreparation).not.toHaveBeenCalled();
  });

  it("fails when preparation storage is unavailable", async () => {
    vi.mocked(enqueueApprovalPreparation).mockResolvedValueOnce(null);

    const response = await approve();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "preparation_storage_unavailable",
    });
  });

  it("queues an idempotent preparation without publishing the pet", async () => {
    const response = await approve();

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "preparing",
      preparationId: preparation.preparationId,
    });
    expect(enqueueApprovalPreparation).toHaveBeenCalledWith(
      expect.objectContaining({
        petId: pendingPet.id,
        petSlug: pendingPet.slug,
        petUpdatedAt: pendingPet.updatedAt,
        reviewerId: "admin_1",
        rankingRevision: RELATED_PETS_V24_PROFILE.rankingRevision,
        expectedActiveGenerationId: readyState.activeGenerationId,
      }),
    );
  });
});

function approve(): Promise<Response> {
  return POST(new Request("http://localhost"), {
    params: Promise.resolve({ id: pendingPet.id }),
  });
}
