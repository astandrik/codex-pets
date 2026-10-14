import { getCurrentPrincipal } from "@/lib/auth/session";
import { petGeneration } from "@/lib/pets/generation/service";
import { assertGenerationOrigin, GENERATION_HEADERS, generationHttpError } from "@/lib/pets/generation/http";
import { readGeneratedSubmission, submissionHttpError } from "@/lib/pets/generation/submission-http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertGenerationOrigin(request);
    const submission = await petGeneration.submit((await params).id, await getCurrentPrincipal());
    return Response.json({ submission }, { status: 201, headers: GENERATION_HEADERS });
  } catch (error) { return generationHttpError(error, true); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertGenerationOrigin(request);
    const {slug,metadataRevision} = await readGeneratedSubmission(request);
    const id=(await params).id,principal=await getCurrentPrincipal();
    const submission = metadataRevision===undefined?await petGeneration.submit(id,principal,slug):await petGeneration.submit(id,principal,slug,metadataRevision);
    return Response.json({ submission }, { status: 201, headers: GENERATION_HEADERS });
  } catch (error) { return submissionHttpError(error); }
}
