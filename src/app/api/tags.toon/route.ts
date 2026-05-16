import { toPublicUrl } from "@/lib/base-path";
import { buildTagsPayload } from "@/lib/pets/api-payloads";
import { listApprovedPets } from "@/lib/pets/repository";
import {
  alternateLinkHeader,
  JSON_MEDIA_TYPE,
  toonResponse,
} from "@/lib/toon/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const pets = await listApprovedPets();

  return toonResponse(buildTagsPayload(pets), {
    headers: {
      "Cache-Control": "public, max-age=60, s-maxage=300",
      Link: alternateLinkHeader(toPublicUrl("/api/tags"), JSON_MEDIA_TYPE),
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}
