import { NextResponse } from "next/server";

import { toPublicUrl } from "@/lib/base-path";
import { buildPetsPayload } from "@/lib/pets/api-payloads";
import { parseGalleryFilters } from "@/lib/pets/gallery-filters";
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

  const result = await searchApprovedPets({
    q: filters.query,
    kind: filters.kind,
    tags: filters.tags,
  });
  return NextResponse.json(buildPetsPayload(result.pets), {
    headers: {
      Link: alternateLinkHeader(
        toPublicUrl(`/api/pets.toon${url.search}`),
        TOON_MEDIA_TYPE,
      ),
    },
  });
}
