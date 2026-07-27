import { NextResponse } from "next/server";

import { jsonApiError } from "@/lib/api-error";
import { toPublicUrl } from "@/lib/base-path";
import { buildPetsPayload } from "@/lib/pets/api-payloads";
import {
  PET_CATALOG_RANKING_HEADER,
  PET_CATALOG_SNAPSHOT_HEADER,
} from "@/lib/pets/catalog-snapshot";
import { getApprovedPetsCatalogSnapshot } from "@/lib/pets/catalog-snapshot-server";
import { parseGalleryFilters } from "@/lib/pets/gallery-filters";
import {
  createPetsPaginationMetadata,
  parsePetsApiPagination,
} from "@/lib/pets/pagination";
import { searchApprovedPets } from "@/lib/pets/search-runtime";
import {
  alternateLinkHeader,
  TOON_MEDIA_TYPE,
} from "@/lib/toon/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filters = parseGalleryFilters(url.searchParams);
  const paginationResult = parsePetsApiPagination(url.searchParams);
  const alternate = alternateLinkHeader(
    toPublicUrl(`/api/pets.toon${url.search}`),
    TOON_MEDIA_TYPE,
  );
  if (!paginationResult.ok) {
    return jsonApiError("invalid_pagination", {
      status: 400,
      message: paginationResult.message,
      field: paginationResult.field,
      hint: "Use positive integer page values and pageSize from 1 to 200.",
      headers: { Link: alternate },
    });
  }
  const pagination = paginationResult.pagination;
  const requestedSnapshotVersion = req.headers
    .get(PET_CATALOG_SNAPSHOT_HEADER)
    ?.trim();
  const requestedRankingVersion = req.headers
    .get(PET_CATALOG_RANKING_HEADER)
    ?.trim();
  const catalogSnapshot =
    pagination && requestedSnapshotVersion
      ? await getApprovedPetsCatalogSnapshot()
      : null;
  if (
    requestedSnapshotVersion &&
    catalogSnapshot &&
    requestedSnapshotVersion !== catalogSnapshot.version
  ) {
    return jsonApiError("catalog_snapshot_changed", {
      status: 409,
      message: "The pet catalog changed while loading the next page.",
      hint: "Refresh the catalog before continuing pagination.",
      headers: {
        Link: alternate,
        [PET_CATALOG_SNAPSHOT_HEADER]: catalogSnapshot.version,
      },
    });
  }

  const searchInput = {
    q: filters.query,
    kind: filters.kind,
    tags: filters.tags,
    ...(pagination
      ? { offset: pagination.offset, limit: pagination.pageSize }
      : {}),
  };
  const result = catalogSnapshot
    ? await searchApprovedPets(searchInput, {
        catalog: catalogSnapshot.pets,
      })
    : await searchApprovedPets(searchInput);
  if (
    filters.query &&
    requestedRankingVersion &&
    requestedRankingVersion !== result.rankingVersion
  ) {
    return jsonApiError("catalog_ranking_changed", {
      status: 409,
      message: "The ranked pet catalog changed while loading the next page.",
      hint: "Refresh the catalog before continuing pagination.",
      headers: {
        Link: alternate,
        [PET_CATALOG_RANKING_HEADER]: result.rankingVersion,
      },
    });
  }
  return NextResponse.json(
    buildPetsPayload(
      result.pets,
      pagination
        ? createPetsPaginationMetadata(pagination, result.total)
        : undefined,
    ),
    {
      headers: {
        Link: alternate,
      },
    },
  );
}
