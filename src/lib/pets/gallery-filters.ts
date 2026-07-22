import type { PetKind } from "@/lib/pets/types";
import { normalizeSearchQuery } from "@/lib/pets/search-ranking";

export const MAX_GALLERY_TAGS = 8;

export type GalleryFilters = {
  query: string;
  kind: PetKind | "all";
  tags: string[];
};

export type GalleryTagSuggestion = {
  name: string;
  count: number;
};

type SearchParamValue = string | string[] | undefined;
type SearchParamsRecord = Record<string, SearchParamValue>;
type SearchParamsInput = SearchParamsRecord | URLSearchParams | undefined;

type FilterablePet = {
  displayName: string;
  description: string;
  kind: PetKind;
  tags: string[];
};

type SuggestedTagsOptions = {
  limit?: number;
  random?: () => number;
};

const GALLERY_KINDS = new Set<PetKind>(["character", "creature", "object"]);

export function parseGalleryFilters(params: SearchParamsInput): GalleryFilters {
  return {
    query: normalizeGalleryQuery(firstParam(readParamValues(params, "q"))),
    kind: parseGalleryKind(firstParam(readParamValues(params, "kind"))),
    tags: normalizeGalleryTags(readParamValues(params, "tags")),
  };
}

export function normalizeGalleryFilters(
  filters: Partial<GalleryFilters> & { q?: string } = {},
): GalleryFilters {
  return {
    query: normalizeGalleryQuery(filters.query ?? filters.q),
    kind: parseGalleryKind(filters.kind),
    tags: normalizeGalleryTags(filters.tags),
  };
}

export function normalizeGalleryQuery(value: unknown): string {
  return normalizeSearchQuery(value).text;
}

export function parseGalleryKind(value: unknown): PetKind | "all" {
  return typeof value === "string" && GALLERY_KINDS.has(value as PetKind)
    ? (value as PetKind)
    : "all";
}

export function normalizeGalleryTags(value: unknown): string[] {
  let tags: string[] = [];
  if (typeof value === "string") {
    tags = [value];
  } else if (Array.isArray(value)) {
    tags = value.filter((tag): tag is string => typeof tag === "string");
  }
  const normalized = tags
    .flatMap((tag) => tag.split(","))
    .map((tag) => tag.replace(/\s+/g, " ").trim().toLowerCase())
    .filter(Boolean);

  return Array.from(new Set(normalized))
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_GALLERY_TAGS);
}

export function serializeGalleryFilters(
  input: Partial<GalleryFilters> & { q?: string } = {},
): string {
  const filters = normalizeGalleryFilters(input);
  const pairs: string[] = [];

  if (filters.query) {
    pairs.push(`q=${encodeURIComponent(filters.query)}`);
  }
  if (filters.kind !== "all") {
    pairs.push(`kind=${encodeURIComponent(filters.kind)}`);
  }
  if (filters.tags.length > 0) {
    pairs.push(
      `tags=${filters.tags.map((tag) => encodeURIComponent(tag)).join(",")}`,
    );
  }

  return pairs.join("&");
}

export function buildGalleryHref(
  input: Partial<GalleryFilters> & { q?: string } = {},
): string {
  const search = serializeGalleryFilters(input);
  return search ? `/?${search}` : "/";
}

export function hasGalleryFilters(
  input: Partial<GalleryFilters> & { q?: string } = {},
): boolean {
  const filters = normalizeGalleryFilters(input);
  return (
    Boolean(filters.query) || filters.kind !== "all" || filters.tags.length > 0
  );
}

export function matchesGalleryFilters(
  pet: FilterablePet,
  input: Partial<GalleryFilters> & { q?: string } = {},
): boolean {
  const filters = normalizeGalleryFilters(input);
  const petTags = pet.tags.map(normalizeTagName).filter(Boolean);

  if (filters.kind !== "all" && pet.kind !== filters.kind) {
    return false;
  }

  if (
    filters.tags.length > 0 &&
    !filters.tags.every((tag) => petTags.includes(tag))
  ) {
    return false;
  }

  if (!filters.query) {
    return true;
  }

  return (
    pet.displayName.toLowerCase().includes(filters.query) ||
    pet.description.toLowerCase().includes(filters.query) ||
    petTags.some((tag) => tag.includes(filters.query))
  );
}

export function collectGalleryTagSuggestions(
  pets: Array<Pick<FilterablePet, "tags">>,
): GalleryTagSuggestion[] {
  const counts = new Map<string, number>();

  for (const pet of pets) {
    for (const tag of normalizeGalleryTags(pet.tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }

  return Array.from(counts, ([name, count]) => ({ name, count })).sort(
    (left, right) =>
      right.count - left.count || left.name.localeCompare(right.name),
  );
}

export function pickSuggestedGalleryTags(
  pets: Array<Pick<FilterablePet, "tags">>,
  selectedTags: readonly string[] = [],
  options: SuggestedTagsOptions = {},
): string[] {
  const limit = options.limit ?? MAX_GALLERY_TAGS;
  if (!Number.isInteger(limit) || limit <= 0) {
    return [];
  }

  const random = options.random ?? Math.random;
  const selected = normalizeGalleryTags([...selectedTags]).slice(0, limit);
  const result = [...selected];
  const selectedSet = new Set(selected);
  const candidates = collectGalleryTagSuggestions(pets).filter(
    (tag) => !selectedSet.has(tag.name),
  );

  while (result.length < limit && candidates.length > 0) {
    const index = pickWeightedIndex(candidates, random);
    const [tag] = candidates.splice(index, 1);
    if (tag) {
      result.push(tag.name);
    }
  }

  return result;
}

function readParamValues(params: SearchParamsInput, key: string): string[] {
  if (!params) {
    return [];
  }

  if (params instanceof URLSearchParams) {
    return params.getAll(key);
  }

  const value = params[key];
  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === "string" ? [value] : [];
}

function firstParam(values: readonly string[]): string | undefined {
  return values[0];
}

function normalizeTagName(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function pickWeightedIndex(
  tags: readonly GalleryTagSuggestion[],
  random: () => number,
): number {
  const total = tags.reduce((sum, tag) => sum + tag.count, 0);
  if (total <= 0) {
    return 0;
  }

  const value = random();
  const normalized = Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 0.999999999)
    : 0;
  let target = normalized * total;

  for (let index = 0; index < tags.length; index += 1) {
    target -= tags[index]?.count ?? 0;
    if (target < 0) {
      return index;
    }
  }

  return tags.length - 1;
}
