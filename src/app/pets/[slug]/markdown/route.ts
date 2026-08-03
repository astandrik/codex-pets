import { markdownResponse } from "@/lib/agent-markdown";
import { buildPetMarkdown } from "@/lib/pets/markdown";
import { getApprovedResolvedRelatedPets } from "@/lib/pets/related-pets-server";
import { getApprovedPetBySlug } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return new Response("not found\n", {
      status: 404,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  }

  const relatedPets = await getApprovedResolvedRelatedPetsBestEffort(pet);
  const response = markdownResponse(buildPetMarkdown(pet, relatedPets), {
    canonicalPath: `/pets/${pet.slug}`,
  });
  // private, not public: the payload embeds related pets, which can
  // disappear from the catalog on moderation; shared caches must not
  // serve them stale, and tag invalidation cannot purge them.
  response.headers.set("Cache-Control", "private, max-age=60");
  return response;
}

async function getApprovedResolvedRelatedPetsBestEffort(
  pet: Parameters<typeof getApprovedResolvedRelatedPets>[0],
): ReturnType<typeof getApprovedResolvedRelatedPets> {
  try {
    return await getApprovedResolvedRelatedPets(pet);
  } catch {
    console.warn("[codex-pets][related-pets]", {
      operation: "resolve",
      status: "failed",
    });
    return [];
  }
}
