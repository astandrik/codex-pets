import {petGeneration} from "@/lib/pets/generation/service";
import {GENERATION_HEADERS, generationHttpError, assertGenerationOrigin, readGenerationJson} from "@/lib/pets/generation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    assertGenerationOrigin(request);
    const input = await readGenerationJson(request, 16 * 1024, true);
    const result = await petGeneration.confirm((await params).id, input);
    return Response.json({generation: result.generation}, {status: result.newlyQueued ? 202 : 200, headers: GENERATION_HEADERS});
  } catch (error) { return generationHttpError(error, true); }
}
