import { beforeEach, describe, expect, it, vi } from "vitest";

const maintenanceMocks = vi.hoisted(() => ({
  deletePetSearchIndexBestEffort: vi.fn(async () => true),
}));

vi.mock("@/lib/pets/search-maintenance", () => maintenanceMocks);

describe("pet repository search maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
  });

  it("removes vectors after rejection", async () => {
    const { moderatePet } = await import("@/lib/pets/repository");

    const pet = await moderatePet({
      petId: "dev_pet_pending_pixel",
      reviewerId: "admin-1",
      decision: "rejected",
    });

    expect(pet?.status).toBe("rejected");
    expect(
      maintenanceMocks.deletePetSearchIndexBestEffort,
    ).toHaveBeenCalledWith("pending-pixel");
  });

  it("removes vectors after soft delete", async () => {
    const { softDeletePetById } = await import("@/lib/pets/repository");

    await expect(
      softDeletePetById({
        petId: "dev_pet_orbit_otter",
        actorUserId: "local-admin",
        actorRole: "admin",
      }),
    ).resolves.toBe(true);
    expect(
      maintenanceMocks.deletePetSearchIndexBestEffort,
    ).toHaveBeenCalledWith("orbit-otter");
  });

  it("returns the status observed before soft delete", async () => {
    const { softDeletePetByIdWithPreviousStatus } = await import(
      "@/lib/pets/repository"
    );

    await expect(
      softDeletePetByIdWithPreviousStatus({
        petId: "dev_pet_pending_pixel",
        actorUserId: "local-admin",
        actorRole: "admin",
      }),
    ).resolves.toEqual({ previousStatus: "pending" });
  });
});
