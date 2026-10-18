import {petGeneration} from "@/lib/pets/generation/service";
import {generationReviewFlowEnabled, readGenerationClientIp} from "@/lib/pets/generation/model";
import {GENERATION_HEADERS, generationHttpError, assertGenerationOrigin} from "@/lib/pets/generation/http";
import {readBrowserGenerationInput} from "@/lib/pets/generation/browser-input";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertGenerationOrigin(request);
    const reviewBase = generationReviewFlowEnabled();
    const {input, reference, multipart, legacyMultipartInput} = await readBrowserGenerationInput(request);
    const ip = readGenerationClientIp(request.headers);
    const generation = multipart ? await petGeneration.generate(input, ip, {reviewBase: true, reference, allowNew: reviewBase, legacyMultipartInput}) : await petGeneration.generate(input, ip);
    return Response.json({generation}, {status: 202, headers: GENERATION_HEADERS});
  } catch (error) { return generationHttpError(error, true); }
}
