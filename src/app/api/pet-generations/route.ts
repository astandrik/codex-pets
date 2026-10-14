import { petGeneration } from "@/lib/pets/generation/service";
import { GenerationError, readGenerationClientIp } from "@/lib/pets/generation/model";
import { GENERATION_HEADERS, generationHttpError, assertGenerationOrigin } from "@/lib/pets/generation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    assertGenerationOrigin(request);
    if (!request.headers.get("content-type")?.startsWith("application/json")) throw new GenerationError("invalid_argument");
    const reader = request.body?.getReader();
    if (!reader) throw new GenerationError("invalid_argument");
    let length = 0; const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > MAX_BODY_BYTES) { await reader.cancel(); throw new GenerationError("body_too_large"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new GenerationError("invalid_argument"); }
    const generation = await petGeneration.generate(body, readGenerationClientIp(request.headers));
    return Response.json({ generation }, { status: 202, headers: GENERATION_HEADERS });
  } catch (error) { return generationHttpError(error, true); }
}
