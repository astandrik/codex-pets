import { buildPetsPayload } from "@/lib/pets/api-payloads";
import { PET_CATALOG_RANKING_HEADER, PET_CATALOG_SNAPSHOT_HEADER } from "@/lib/pets/catalog-snapshot";
import { getApprovedPetsCatalogSnapshot } from "@/lib/pets/catalog-snapshot-server";
import type { GalleryFilters } from "@/lib/pets/gallery-filters";
import { createPetsPaginationMetadata, MAX_PETS_API_PAGE_SIZE, type PetsApiPagination } from "@/lib/pets/pagination";
import { searchApprovedPets } from "@/lib/pets/search/search-runtime";

type CatalogPageResult =
  | { ok: true; payload: ReturnType<typeof buildPetsPayload> }
  | {
      ok: false;
      code: "catalog_snapshot_changed" | "catalog_ranking_changed";
      message: string;
      hint: string;
      headers: Record<string, string>;
    };

export async function readPetsCatalogPage(input: {
  filters: GalleryFilters;
  pagination: PetsApiPagination | null;
  snapshotVersion: string | null;
  rankingVersion: string | null;
}): Promise<CatalogPageResult> {
  const { filters, pagination } = input;
  const effectivePagination = pagination ?? {
    page: 1,
    pageSize: MAX_PETS_API_PAGE_SIZE,
    offset: 0,
  };
  const requestedSnapshot = input.snapshotVersion?.trim();
  const requestedRanking = input.rankingVersion?.trim();
  const snapshot = pagination && requestedSnapshot
    ? await getApprovedPetsCatalogSnapshot()
    : null;
  if (requestedSnapshot && snapshot && requestedSnapshot !== snapshot.version) {
    return {
      ok: false,
      code: "catalog_snapshot_changed",
      message: "The pet catalog changed while loading the next page.",
      hint: "Refresh the catalog before continuing pagination.",
      headers: { [PET_CATALOG_SNAPSHOT_HEADER]: snapshot.version },
    };
  }

  const searchInput = {
    q: filters.query,
    kind: filters.kind,
    tags: filters.tags,
    offset: effectivePagination.offset,
    limit: effectivePagination.pageSize,
  };
  const result = snapshot
    ? await searchApprovedPets(searchInput, { catalog: snapshot.pets })
    : await searchApprovedPets(searchInput);
  if (filters.query && requestedRanking && requestedRanking !== result.rankingVersion) {
    return {
      ok: false,
      code: "catalog_ranking_changed",
      message: "The ranked pet catalog changed while loading the next page.",
      hint: "Refresh the catalog before continuing pagination.",
      headers: { [PET_CATALOG_RANKING_HEADER]: result.rankingVersion },
    };
  }
  return {
    ok: true,
    payload: buildPetsPayload(
      result.pets,
      createPetsPaginationMetadata(effectivePagination, result.total),
    ),
  };
}
