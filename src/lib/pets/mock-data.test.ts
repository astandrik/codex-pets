import { afterEach, describe, expect, it, vi } from "vitest";

import { storePetAssetsInYdb, readPetAssetFile } from "@/lib/pets/assets-repository";
import {
  createPendingPet,
  getPetBySlug,
  getPetMetrics,
  incrementDownload,
  incrementLike,
  listPendingPets,
  moderatePet,
  softDeletePetById,
} from "@/lib/pets/repository";

describe("mock pet data source", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("persists uploaded assets and pet mutations in memory", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");

    const suffix = crypto.randomUUID().slice(0, 8);
    const assetId = `asset_mock_${suffix}`;
    const petJson = {
      id: `mock-review-${suffix}`,
      displayName: "Mock Review Pet",
      description: "A mock pet created by a unit test.",
      spritesheetPath: "spritesheet.webp",
    };
    const petJsonBuffer = Buffer.from(JSON.stringify(petJson));
    const spritesheetBuffer = Buffer.from("mock-spritesheet");
    const zipBuffer = Buffer.from("mock-zip");

    const assetUrls = await storePetAssetsInYdb({
      assetId,
      petJsonBuffer,
      spritesheetBuffer,
      zipBuffer,
      spritesheetExt: "webp",
    });

    const created = await createPendingPet({
      petJson,
      ownerId: "local-admin",
      ownerEmail: "local-admin@example.com",
      ownerName: "Local Admin",
      contactEmail: "local-admin@example.com",
      kind: "creature",
      tags: ["mock"],
      ...assetUrls,
      spritesheetExt: "webp",
    });

    expect((await getPetBySlug(created.slug))?.status).toBe("pending");
    expect((await listPendingPets()).some((pet) => pet.id === created.id)).toBe(
      true,
    );

    const spritesheet = await readPetAssetFile({
      assetId,
      filename: "spritesheet.webp",
    });
    expect(spritesheet.contentType).toBe("image/webp");
    expect(spritesheet.buffer.equals(spritesheetBuffer)).toBe(true);

    const approved = await moderatePet({
      petId: created.id,
      reviewerId: "local-admin",
      decision: "approved",
    });
    expect(approved?.status).toBe("approved");
    expect((await getPetBySlug(created.slug))?.status).toBe("approved");

    await incrementDownload(created.slug);
    await expect(incrementLike(created.slug)).resolves.toBe(1);
    await expect(getPetMetrics(created.slug)).resolves.toEqual({
      downloadCount: 1,
      installCount: 0,
      likeCount: 1,
    });

    await expect(
      softDeletePetById({
        petId: created.id,
        actorUserId: "local-admin",
        actorRole: "user",
      }),
    ).resolves.toBe(true);
    expect((await getPetBySlug(created.slug))?.status).toBe("deleted");
  });

  it("keeps contact email private until moderator publication is confirmed", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    const suffix = crypto.randomUUID().slice(0, 8);
    const created = await createPendingPet({
      petJson: {
        id: `mock-public-email-${suffix}`,
        displayName: "Public Email Pet",
        description: "A mock pet with opted-in author email.",
        spritesheetPath: "spritesheet.webp",
      },
      ownerId: "",
      ownerEmail: null,
      ownerName: "creator+tag",
      contactEmail: "creator+tag@example.com",
      publicEmailRequested: true,
      kind: "creature",
      tags: ["mock"],
      zipUrl: "/api/assets/mock/package.zip",
      petJsonUrl: "/api/assets/mock/pet.json",
      spritesheetUrl: "/api/assets/mock/spritesheet.webp",
      spritesheetExt: "webp",
    });

    const approvedWithoutEmail = await moderatePet({
      petId: created.id,
      reviewerId: "local-admin",
      decision: "approved",
      publishRequestedEmail: false,
    });
    expect(approvedWithoutEmail?.publicAuthorEmail).toBeNull();

    const approvedWithEmail = await moderatePet({
      petId: created.id,
      reviewerId: "local-admin",
      decision: "approved",
      publishRequestedEmail: true,
    });
    expect(approvedWithEmail?.publicAuthorEmail).toBe(
      "creator+tag@example.com",
    );

    const rejected = await moderatePet({
      petId: created.id,
      reviewerId: "local-admin",
      decision: "rejected",
      reason: "not ready",
    });
    expect(rejected).toMatchObject({
      status: "rejected",
      publicEmailRequested: true,
      publicAuthorEmail: null,
    });
  });
});
