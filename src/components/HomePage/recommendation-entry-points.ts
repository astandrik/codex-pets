import { buildGalleryHref } from "@/lib/pets/gallery-filters";

const STYLE_TAGS = ["cute", "pixel", "anime", "fantasy", "minimal"] as const;
const DEFAULT_LINK_LIMIT = 3;
export const HOME_GALLERY_LIMIT = 12;
export const HOME_HERO_PET_LIMIT = 12;

type RecommendationPet = {
  slug: string;
  displayName: string;
  tags: string[];
  likeCount: number;
  downloadCount: number;
  installCount: number;
  createdAt: string;
  approvedAt: string | null;
};

export type HomeRecommendationEntryPoints = {
  styleTags: Array<{ tag: string; href: string }>;
  popularPets: Array<{ slug: string; displayName: string; href: string }>;
  recentPets: Array<{ slug: string; displayName: string; href: string }>;
};

export function buildHomeRecommendationEntryPoints(
  pets: RecommendationPet[],
  limit = DEFAULT_LINK_LIMIT,
): HomeRecommendationEntryPoints {
  const normalizedLimit = Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LINK_LIMIT;
  const availableTags = new Set(
    pets.flatMap((pet) => pet.tags.map((tag) => tag.trim().toLowerCase())),
  );

  return {
    styleTags: STYLE_TAGS.filter((tag) => availableTags.has(tag)).map((tag) => ({
      tag,
      href: buildGalleryHref({ tags: [tag] }),
    })),
    popularPets: pets
      .filter((pet) => popularityScore(pet) > 0)
      .toSorted(
        (left, right) =>
          popularityScore(right) - popularityScore(left) ||
          left.displayName.localeCompare(right.displayName),
      )
      .slice(0, normalizedLimit)
      .map(toPetLink),
    recentPets: pets
      .toSorted(
        (left, right) =>
          dateScore(right.approvedAt ?? right.createdAt) -
          dateScore(left.approvedAt ?? left.createdAt),
      )
      .slice(0, normalizedLimit)
      .map(toPetLink),
  };
}

export function sliceHomeGalleryPets<T>(pets: T[], hasActiveFilters: boolean): T[] {
  return hasActiveFilters ? pets : pets.slice(0, HOME_GALLERY_LIMIT);
}

function popularityScore(pet: RecommendationPet): number {
  return pet.likeCount + pet.downloadCount + pet.installCount;
}

function dateScore(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function toPetLink(pet: RecommendationPet) {
  return {
    slug: pet.slug,
    displayName: pet.displayName,
    href: `/pets/${encodeURIComponent(pet.slug)}`,
  };
}
