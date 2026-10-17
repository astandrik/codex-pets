import {petGeneration} from "@/lib/pets/generation/service";
import {GENERATION_HEADERS, generationHttpError} from "@/lib/pets/generation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  try {
    const bytes = await petGeneration.getBase((await params).id);
    return new Response(new Uint8Array(bytes), {headers: {...GENERATION_HEADERS, "Content-Type": "image/png"}});
  } catch (error) { return generationHttpError(error); }
}
