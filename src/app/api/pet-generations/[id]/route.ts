import { petGeneration } from "@/lib/pets/generation/service";
import { GENERATION_HEADERS, generationHttpError } from "@/lib/pets/generation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return Response.json({ generation: await petGeneration.get((await params).id) }, { headers: GENERATION_HEADERS });
  } catch (error) { return generationHttpError(error); }
}
