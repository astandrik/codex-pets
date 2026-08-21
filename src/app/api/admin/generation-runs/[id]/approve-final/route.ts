import { jsonApiError, jsonValidationError } from "@/lib/api-error";
import { requireGenerationAdmin } from "@/lib/pets/generation/admin-api";
import { validateGenerationFinalMetadata } from "@/lib/pets/generation/final-metadata";
import { submitGenerationRun } from "@/lib/pets/generation/submission";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGenerationAdmin();
  if (!access.ok) return access.response;
  let body: unknown;
  try { body = await req.json(); }
  catch { return jsonApiError("invalid_json", { status: 400, message: "Request body must be valid JSON." }); }
  const metadata = validateGenerationFinalMetadata(body);
  if (!metadata.ok) return jsonValidationError(metadata);
  const result = await submitGenerationRun({
    runId: (await params).id,
    approvedBy: access.principal.userId,
    metadata: metadata.value,
  });
  if (!result.ok) return jsonApiError(result.error, {
    status: result.error === "not_found" ? 404 : 409,
    message: result.message,
  });
  return Response.json({ ok: true, run: result.run });
}
