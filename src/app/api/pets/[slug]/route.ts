import { NextResponse } from "next/server";

import { toPublicUrl } from "@/lib/base-path";
import { buildPetDetailPayload } from "@/lib/pets/api-payloads";
import { getApprovedPetBySlug } from "@/lib/pets/repository";
import {
  alternateLinkHeader,
  JSON_MEDIA_TYPE,
  toonResponse,
  TOON_MEDIA_TYPE,
} from "@/lib/toon/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug: rawSlug } = await params;
  const isToon = rawSlug.endsWith(".toon");
  const slug = isToon ? rawSlug.slice(0, -".toon".length) : rawSlug;
  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    const body = { error: "not_found" };
    return isToon
      ? toonResponse(body, {
          status: 404,
          headers: {
            Link: alternateLinkHeader(
              toPublicUrl(`/api/pets/${encodeURIComponent(slug)}`),
              JSON_MEDIA_TYPE,
            ),
          },
        })
      : NextResponse.json(body, { status: 404 });
  }

  const body = buildPetDetailPayload(pet);
  if (isToon) {
    return toonResponse(body, {
      headers: {
        Link: alternateLinkHeader(
          toPublicUrl(`/api/pets/${encodeURIComponent(slug)}`),
          JSON_MEDIA_TYPE,
        ),
      },
    });
  }

  return NextResponse.json(body, {
    headers: {
      Link: alternateLinkHeader(
        toPublicUrl(`/api/pets/${encodeURIComponent(slug)}.toon`),
        TOON_MEDIA_TYPE,
      ),
    },
  });
}
