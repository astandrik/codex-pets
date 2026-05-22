import type { Metadata } from "next";
import { HomePage } from "@/components/HomePage/HomePage";
import { unstable_cache } from "next/cache";
import {
  matchesGalleryFilters,
  parseGalleryFilters,
  pickSuggestedGalleryTags,
} from "@/lib/pets/gallery-filters";
import { listApprovedPets } from "@/lib/pets/repository";
import { buildGalleryPageMetadata } from "@/lib/site-metadata";
import type { PublicPet, PublicPetSummary } from "@/lib/pets/types";

export const runtime = "nodejs";
// Keep request-time rendering because YDB runtime env is only available in the
// running container, then cache the public gallery snapshot explicitly.
export const dynamic = "force-dynamic";

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPets(),
  [
    "approved-pets-gallery",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: HomeProps): Promise<Metadata> {
  const filters = parseGalleryFilters(await searchParams);
  return buildGalleryPageMetadata(filters);
}

export default async function Home({ searchParams }: HomeProps) {
  const filters = parseGalleryFilters(await searchParams);
  const pets = (await getApprovedPetsSnapshot()).map(toPublicPetSummary);
  const filteredPets = pets.filter((pet) => matchesGalleryFilters(pet, filters));
  const suggestedTags = pickSuggestedGalleryTags(pets, filters.tags);

  return (
    <HomePage
      pets={pets}
      filteredPets={filteredPets}
      query={filters.query}
      kind={filters.kind}
      selectedTags={filters.tags}
      suggestedTags={suggestedTags}
    />
  );
}

function toPublicPetSummary(pet: PublicPet): PublicPetSummary {
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
    ownerProfileSlug: pet.ownerProfileSlug,
    ownerAvatarUrl: pet.ownerAvatarUrl,
    createdAt: pet.createdAt,
    approvedAt: pet.approvedAt,
    downloadCount: pet.downloadCount,
    installCount: pet.installCount,
    likeCount: pet.likeCount,
  };
}
