import {petGeneration} from "@/lib/pets/generation/service";
import {GenerationError} from "@/lib/pets/generation/model";
import {assertGenerationOrigin, GENERATION_HEADERS, generationHttpError, readGenerationBody} from "@/lib/pets/generation/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    assertGenerationOrigin(request);
    if (request.body && (await readGenerationBody(request, 16 * 1024)).length) throw new GenerationError("invalid_argument");
    const generation = await petGeneration.acceptAnimationRevision((await params).id);
    return Response.json({generation}, {headers: GENERATION_HEADERS});
  } catch (error) {return generationHttpError(error, true);}
}
