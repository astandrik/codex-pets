import { buildApiErrorBody } from "@/lib/api-error";
import { toPublicUrl } from "@/lib/base-path";
import { buildPetsPayload } from "@/lib/pets/api-payloads";
import { parseGalleryFilters } from "@/lib/pets/gallery-filters";
import {
  createPetsPaginationMetadata,
  parsePetsApiPagination,
} from "@/lib/pets/pagination";
import { searchApprovedPets } from "@/lib/pets/search-runtime";
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
  const pagination = paginationResult.pagination;

  const result = await searchApprovedPets({
    q: filters.query,
    kind: filters.kind,
    tags: filters.tags,
    ...(pagination
      ? { offset: pagination.offset, limit: pagination.pageSize }
      : {}),
  });
  return toonResponse(
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
