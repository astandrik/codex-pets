import {petGeneration} from "@/lib/pets/generation/service";
import {readGenerationClientIp} from "@/lib/pets/generation/model";
import {assertGenerationOrigin, GENERATION_HEADERS, generationHttpError, readGenerationJson} from "@/lib/pets/generation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = {params: Promise<{id: string}>};
export async function POST(request: Request, {params}: Context) {
  try {
    assertGenerationOrigin(request);
    const input = await readGenerationJson(request, 16 * 1024);
    const generation = await petGeneration.reviseAnimations((await params).id, input, readGenerationClientIp(request.headers));
    return Response.json({generation}, {status: 202, headers: GENERATION_HEADERS});
  } catch (error) {return generationHttpError(error, true);}
}
export async function GET(request: Request, {params}: Context) {
  try {
    const generation = await petGeneration.findAnimationRevision((await params).id, new URL(request.url).searchParams.get("requestId") ?? "");
    return Response.json({generation}, {headers: GENERATION_HEADERS});
  } catch (error) {return generationHttpError(error, true);}
}
