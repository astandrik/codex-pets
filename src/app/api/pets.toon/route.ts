import { toPublicUrl } from "@/lib/base-path";
import { buildPetsPayload } from "@/lib/pets/api-payloads";
import { listApprovedPets } from "@/lib/pets/repository";
import { normalizeKind } from "@/lib/pets/validation";
import {
  alternateLinkHeader,
  JSON_MEDIA_TYPE,
  toonResponse,
} from "@/lib/toon/response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const rawKind = url.searchParams.get("kind");
  const kind = rawKind && rawKind !== "all" ? normalizeKind(rawKind) : "all";

  const pets = await listApprovedPets({ q, kind });
  return toonResponse(buildPetsPayload(pets), {
    headers: {
      Link: alternateLinkHeader(
        toPublicUrl(`/api/pets${url.search}`),
        JSON_MEDIA_TYPE,
      ),
    },
  });
}
