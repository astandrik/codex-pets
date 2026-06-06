import { markdownResponse } from "@/lib/agent-markdown";
import { buildPetMarkdown } from "@/lib/pets/markdown";
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
    return new Response("not found", { status: 404 });
  }

  const response = markdownResponse(buildPetMarkdown(pet));
  response.headers.set("Cache-Control", "public, max-age=60, s-maxage=300");
  return response;
}
