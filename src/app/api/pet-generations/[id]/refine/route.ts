import {petGeneration} from "@/lib/pets/generation/service";
import {generationInputSchema, generationReviewFlowEnabled, normalizeGenerationText, readGenerationClientIp, GenerationError} from "@/lib/pets/generation/model";
import {assertGenerationOrigin, GENERATION_HEADERS, generationHttpError, readGenerationJson} from "@/lib/pets/generation/http";

const inputSchema = generationInputSchema.omit({displayName: true});
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    assertGenerationOrigin(request);
    const raw = await readGenerationJson(request, 16 * 1024);
    const input = inputSchema.safeParse(raw && typeof raw === "object" && "prompt" in raw && typeof raw.prompt === "string"
      ? {...raw, prompt: normalizeGenerationText(raw.prompt)} : raw);
    if (!input.success) throw new GenerationError("invalid_argument");
    const generation = await petGeneration.generate(input.data, readGenerationClientIp(request.headers), {
      reviewBase: true, sourceBaseId: (await params).id, allowNew: generationReviewFlowEnabled(),
    });
    return Response.json({generation}, {status: 202, headers: GENERATION_HEADERS});
  } catch (error) {return generationHttpError(error, true);}
}
