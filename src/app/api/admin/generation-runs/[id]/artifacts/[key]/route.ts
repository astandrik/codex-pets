import { jsonApiError } from "@/lib/api-error";
import { requireGenerationAdmin } from "@/lib/pets/generation/admin-api";
import { getGenerationRunById, readGenerationArtifact } from "@/lib/pets/generation/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; key: string }> }) {
  const access = await requireGenerationAdmin({ requireEnabled: false });
  if (!access.ok) return access.response;
  const { id, key } = await params;
  if (key.startsWith("work-")) return jsonApiError("not_found", { status: 404, message: "Artifact was not found." });
  if (!await getGenerationRunById(id)) return jsonApiError("not_found", { status: 404, message: "Generation run was not found." });
  let artifact;
  try { artifact = await readGenerationArtifact({ runId: id, key }); }
  catch { return jsonApiError("invalid_artifact_key", { status: 400, message: "Artifact key is invalid." }); }
  if (!artifact) return jsonApiError("not_found", { status: 404, message: "Artifact was not found." });
  return new Response(new Uint8Array(artifact.buffer), { headers: {
    "Cache-Control": "private, no-store",
    "Content-Type": artifact.metadata.contentType,
    "Content-Disposition": `inline; filename="${safeName(artifact.metadata.fileName)}"`,
    "X-Content-Type-Options": "nosniff",
  } });
}
function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "artifact";
}
