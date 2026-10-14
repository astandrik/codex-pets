import { NextResponse } from "next/server";

import { jsonApiError } from "@/lib/api-error";
import { toPublicUrl } from "@/lib/base-path";
import { readPetsCatalogPage } from "@/lib/pets/catalog-page";
import {
  PET_CATALOG_RANKING_HEADER,
  PET_CATALOG_SNAPSHOT_HEADER,
} from "@/lib/pets/catalog-snapshot";
import { parseGalleryFilters } from "@/lib/pets/gallery-filters";
import {
  parsePetsApiPagination,
} from "@/lib/pets/pagination";
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
  const result = await readPetsCatalogPage({
    filters,
    pagination: paginationResult.pagination,
    snapshotVersion: req.headers.get(PET_CATALOG_SNAPSHOT_HEADER),
    rankingVersion: req.headers.get(PET_CATALOG_RANKING_HEADER),
  });
  if (!result.ok) {
    return jsonApiError(result.code, {
      status: 409,
      message: result.message,
      hint: result.hint,
      headers: { Link: alternate, ...result.headers },
    });
  }
  return NextResponse.json(result.payload, { headers: { Link: alternate } });
}
