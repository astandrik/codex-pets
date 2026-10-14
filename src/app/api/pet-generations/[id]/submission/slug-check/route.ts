import { petGeneration } from "@/lib/pets/generation/service";
import { assertGenerationOrigin, GENERATION_HEADERS } from "@/lib/pets/generation/http";
import { readSubmissionSlug, submissionHttpError } from "@/lib/pets/generation/submission-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertGenerationOrigin(request);
    const slug = await readSubmissionSlug(request);
    const result = await petGeneration.checkSubmissionSlug((await params).id, slug);
    return Response.json(result, { headers: GENERATION_HEADERS });
  } catch (error) { return submissionHttpError(error); }
}
