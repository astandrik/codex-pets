import { NextResponse } from "next/server";

import { toPublicUrl } from "@/lib/base-path";
import { buildManifestPayload } from "@/lib/pets/api-payloads";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import {
  alternateLinkHeader,
  TOON_MEDIA_TYPE,
} from "@/lib/toon/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const pets = await listApprovedPetsForSearch();
  return NextResponse.json(
    buildManifestPayload(pets),
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        Link: alternateLinkHeader(toPublicUrl("/api/manifest.toon"), TOON_MEDIA_TYPE),
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
