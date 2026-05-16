import { toPublicUrl } from "@/lib/base-path";
import { buildPetInstallCommand } from "@/lib/pets/install-command";
import type { PublicPet } from "@/lib/pets/types";

export type PublicPetPayload = Omit<PublicPet, "contactEmail">;

export function buildManifestPayload(
  pets: PublicPet[],
  generatedAt = new Date().toISOString(),
) {
  return {
    generatedAt,
    total: pets.length,
    pets: pets.map((pet) => ({
      slug: pet.slug,
      displayName: pet.displayName,
      description: pet.description,
      kind: pet.kind,
      tags: pet.tags,
      submittedBy: pet.ownerName,
      pageUrl: toPublicUrl(`/pets/${pet.slug}`),
      spritesheetUrl: pet.spritesheetUrl,
      petJsonUrl: pet.petJsonUrl,
      zipUrl: pet.zipUrl,
      installCommand: buildPetInstallCommand(pet.slug),
      createdAt: pet.createdAt,
      approvedAt: pet.approvedAt,
    })),
  };
}

export function buildPetsPayload(pets: PublicPet[]) {
  return {
    total: pets.length,
    pets: pets.map(createPublicPetPayload),
  };
}

export function buildPetDetailPayload(pet: PublicPet) {
  return { pet: createPublicPetPayload(pet) };
}

export function createPublicPetPayload(pet: PublicPet): PublicPetPayload {
  return {
    id: pet.id,
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    spritesheetUrl: pet.spritesheetUrl,
    petJsonUrl: pet.petJsonUrl,
    zipUrl: pet.zipUrl,
    spritesheetExt: pet.spritesheetExt,
    kind: pet.kind,
    tags: pet.tags,
    status: pet.status,
    ownerName: pet.ownerName,
    createdAt: pet.createdAt,
    approvedAt: pet.approvedAt,
    downloadCount: pet.downloadCount,
    installCount: pet.installCount,
    likeCount: pet.likeCount,
  };
}

export function buildTagsPayload(
  pets: PublicPet[],
  generatedAt = new Date().toISOString(),
) {
  const counts = new Map<string, number>();

  for (const pet of pets) {
    for (const tag of pet.tags) {
      const name = tag.trim().toLowerCase();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const tags = Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  return {
    generatedAt,
    total: tags.length,
    tags,
  };
}
