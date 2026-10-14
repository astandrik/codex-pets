import { buildApiErrorBody } from "@/lib/api-error";
import { toPublicUrl } from "@/lib/base-path";
import { readPetsCatalogPage } from "@/lib/pets/catalog-page";
import { PET_CATALOG_RANKING_HEADER, PET_CATALOG_SNAPSHOT_HEADER } from "@/lib/pets/catalog-snapshot";
import { parseGalleryFilters } from "@/lib/pets/gallery-filters";
import {
  parsePetsApiPagination,
} from "@/lib/pets/pagination";
import {
  alternateLinkHeader,
  JSON_MEDIA_TYPE,
  toonResponse,
} from "@/lib/toon/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const filters = parseGalleryFilters(url.searchParams);
  const paginationResult = parsePetsApiPagination(url.searchParams);
  const alternate = alternateLinkHeader(
    toPublicUrl(`/api/pets${url.search}`),
    JSON_MEDIA_TYPE,
  );
  if (!paginationResult.ok) {
    return toonResponse(
      buildApiErrorBody("invalid_pagination", {
        message: paginationResult.message,
        field: paginationResult.field,
        hint: "Use positive integer page values and pageSize from 1 to 200.",
      }),
      {
        status: 400,
        headers: { Link: alternate },
      },
    );
  }
  const result = await readPetsCatalogPage({
    filters,
    pagination: paginationResult.pagination,
    snapshotVersion: req.headers.get(PET_CATALOG_SNAPSHOT_HEADER),
    rankingVersion: req.headers.get(PET_CATALOG_RANKING_HEADER),
  });
  if (!result.ok) {
    return toonResponse(buildApiErrorBody(result.code, {
      message: result.message,
      hint: result.hint,
    }), {
      status: 409,
      headers: { Link: alternate, ...result.headers },
    });
  }
  return toonResponse(result.payload, { headers: { Link: alternate } });
}
