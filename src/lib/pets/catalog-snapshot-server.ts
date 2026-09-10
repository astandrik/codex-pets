import { createHash } from "node:crypto";

import { unstable_cache } from "next/cache";

import type { ApprovedPetsCatalogSnapshot } from "@/lib/pets/catalog-snapshot";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import type { PublicPet } from "@/lib/pets/types";

const getCachedApprovedPetsCatalogSnapshot = unstable_cache(
  async () =>
    createApprovedPetsCatalogSnapshot(await listApprovedPetsForSearch()),
  [
    "approved-pets-gallery",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

export function getApprovedPetsCatalogSnapshot(): Promise<ApprovedPetsCatalogSnapshot> {
  return getCachedApprovedPetsCatalogSnapshot();
}

export function createApprovedPetsCatalogSnapshot(
  pets: PublicPet[],
): ApprovedPetsCatalogSnapshot {
  const version = createHash("sha256")
    .update(
      JSON.stringify(
        pets.map((pet) => ({
          slug: pet.slug,
          displayName: pet.displayName,
          description: pet.description,
          spritesheetUrl: pet.spritesheetUrl,
          petJsonUrl: pet.petJsonUrl,
          zipUrl: pet.zipUrl,
          spritesheetExt: pet.spritesheetExt,
          kind: pet.kind,
          tags: pet.tags,
          ownerName: pet.ownerName,
          ownerProfileSlug: pet.ownerProfileSlug,
          ownerAvatarUrl: pet.ownerAvatarUrl,
          publicAuthorEmail: pet.publicAuthorEmail ?? null,
          createdAt: pet.createdAt,
          approvedAt: pet.approvedAt,
        })),
      ),
    )
    .digest("base64url");

  return { pets, version };
}
