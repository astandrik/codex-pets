import { toPublicUrl } from "@/lib/base-path";
import { buildPetInstallCommand } from "@/lib/pets/install-command";
import type { PublicPet } from "@/lib/pets/types";
import type { PetsPaginationMetadata } from "@/lib/pets/pagination";

export type PublicPetPayload = Omit<
  PublicPet,
  "contactEmail" | "publicEmailRequested"
> & {
  ownerProfileUrl: string | null;
};

export function isPublicPetPayload(value: unknown): value is PublicPetPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const pet = value as Record<string, unknown>;
  return (
    [pet.id, pet.slug, pet.displayName, pet.description, pet.spritesheetUrl,
      pet.petJsonUrl, pet.zipUrl, pet.createdAt].every((field) => typeof field === "string") &&
    (pet.spritesheetExt === "webp" || pet.spritesheetExt === "png") &&
    (pet.kind === "creature" || pet.kind === "object" || pet.kind === "character") &&
    (pet.status === "approved" || pet.status === "pending" || pet.status === "rejected" || pet.status === "deleted") &&
    Array.isArray(pet.tags) && pet.tags.every((tag) => typeof tag === "string") &&
    [pet.ownerName, pet.ownerProfileUrl, pet.approvedAt]
      .every((field) => field === null || typeof field === "string") &&
    [pet.ownerProfileSlug, pet.ownerAvatarUrl, pet.publicAuthorEmail]
      .every((field) => field == null || typeof field === "string") &&
    [pet.downloadCount, pet.installCount, pet.likeCount]
      .every((field) => typeof field === "number" && Number.isFinite(field))
  );
}

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
      submittedByEmail: pet.publicAuthorEmail ?? null,
      submittedByUrl: pet.ownerProfileSlug
        ? toPublicUrl(`/users/${pet.ownerProfileSlug}`)
        : null,
      submittedByAvatarUrl: pet.ownerAvatarUrl
        ? toPublicUrl(pet.ownerAvatarUrl)
        : null,
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

export function buildPetsPayload(
  pets: PublicPet[],
  pagination: PetsPaginationMetadata,
) {
  return {
    total: pets.length,
    pets: pets.map(createPublicPetPayload),
    pagination,
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
    ownerProfileSlug: pet.ownerProfileSlug ?? null,
    ownerProfileUrl: pet.ownerProfileSlug
      ? toPublicUrl(`/users/${pet.ownerProfileSlug}`)
      : null,
    ownerAvatarUrl: pet.ownerAvatarUrl ? toPublicUrl(pet.ownerAvatarUrl) : null,
    publicAuthorEmail: pet.publicAuthorEmail ?? null,
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
