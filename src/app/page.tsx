import type { Metadata } from "next";
import { HomePage } from "@/components/HomePage/HomePage";
import { unstable_cache } from "next/cache";
import {
  hasGalleryFilters,
  parseGalleryFilters,
  pickSuggestedGalleryTags,
} from "@/lib/pets/gallery-filters";
import {
  countApprovedPets,
  listApprovedPets,
} from "@/lib/pets/repository";
import { searchApprovedPets } from "@/lib/pets/search-runtime";
import {
  buildGalleryPageMetadata,
  getHomepageJsonLdGraph,
} from "@/lib/site-metadata";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  HOME_FEATURED_PET_LIMIT,
  sliceHomeGalleryPets,
} from "@/components/HomePage/recommendation-entry-points";
import type { PublicPet, PublicPetSummary } from "@/lib/pets/types";

export const runtime = "nodejs";
// Keep request-time rendering because YDB runtime env is only available in the
// running container, then cache the public gallery snapshot explicitly.
export const dynamic = "force-dynamic";

const getApprovedPetsSnapshot = unstable_cache(
  async () => {
    const [pets, total] = await Promise.all([
      listApprovedPets(),
      countApprovedPets(),
    ]);
    return { pets, total };
  },
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
  const rawSearchParams = await searchParams;
  const filters = parseGalleryFilters(rawSearchParams);
  return buildGalleryPageMetadata(
    filters,
    hasGalleryFilterSearchParam(rawSearchParams),
    getGalleryPageViewPath(rawSearchParams),
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const filters = parseGalleryFilters(await searchParams);
  const approvedPetsPromise = getApprovedPetsSnapshot();
  const searchResultPromise = hasGalleryFilters(filters)
    ? searchApprovedPets({
        q: filters.query,
        kind: filters.kind,
        tags: filters.tags,
      })
    : Promise.resolve(null);
  const [approvedPetsSnapshot, searchResult] = await Promise.all([
    approvedPetsPromise,
    searchResultPromise,
  ]);
  const approvedPets = approvedPetsSnapshot.pets;
  const galleryPets = searchResult?.pets ?? approvedPets;

  const pets = approvedPets.map(toPublicPetSummary);
  const filteredPets = galleryPets.map(toPublicPetSummary);
  const visiblePets = sliceHomeGalleryPets(filteredPets);
  const suggestedTags = pickSuggestedGalleryTags(pets, filters.tags);
  const homepageJsonLd = getHomepageJsonLdGraph(
    visiblePets.slice(0, HOME_FEATURED_PET_LIMIT),
  );

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(homepageJsonLd) }}
      />
      <HomePage
        pets={pets}
        filteredPets={visiblePets}
        filteredTotal={searchResult?.total ?? approvedPetsSnapshot.total}
        query={filters.query}
        kind={filters.kind}
        selectedTags={filters.tags}
        suggestedTags={suggestedTags}
      />
    </>
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

function hasGalleryFilterSearchParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): boolean {
  return ["q", "tags", "kind"].some((key) =>
    Object.hasOwn(searchParams ?? {}, key),
  );
}

function getGalleryPageViewPath(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string {
  const serialized = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) {
        serialized.append(key, item);
      }
    }
  }

  const search = serialized.toString();
  return search ? `/?${search}` : "/";
}
