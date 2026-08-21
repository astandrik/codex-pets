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
  const contentType = safeContentType(artifact.metadata.contentType);
  const disposition = INLINE_IMAGE_TYPES.has(contentType) ? "inline" : "attachment";
  return new Response(new Uint8Array(artifact.buffer), { headers: {
    "Cache-Control": "private, no-store",
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${safeName(artifact.metadata.fileName)}"`,
    "X-Content-Type-Options": "nosniff",
  } });
}
const INLINE_IMAGE_TYPES = new Set(["image/png", "image/webp", "image/gif"]);
function safeContentType(value: string) {
  if (INLINE_IMAGE_TYPES.has(value)) return value;
  return value === "application/json; charset=utf-8" ? value : "application/octet-stream";
}
function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "artifact";
}
