import { petGeneration } from "@/lib/pets/generation/service";
import { generationStore } from "@/lib/pets/generation/store";
import { GenerationError } from "@/lib/pets/generation/model";
import { GENERATION_HEADERS, generationHttpError } from "@/lib/pets/generation/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const TYPES: Record<string, string> = { "pet.json": "application/json", "spritesheet.webp": "image/webp", "pet.zip": "application/zip" };

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  try {
    const { id, file } = await params;
    const type = Object.hasOwn(TYPES, file) ? TYPES[file] : null;
    if (!type) throw new GenerationError("not_found");
    const status = await petGeneration.get(id);
    if (status.status !== "completed") throw new GenerationError("not_found");
    if (file === "pet.zip" && status.animationRevision && status.animationRevision.acceptedAt === undefined) throw new GenerationError("animation_revision_not_accepted");
    const data = await generationStore.readArtifact(id, file, Date.now());
    if (!data) throw new GenerationError("not_found");
    return new Response(new Uint8Array(data), { headers: { ...GENERATION_HEADERS, "Content-Type": type, ...(file === "pet.zip" ? { "Content-Disposition": 'attachment; filename="pet.zip"' } : {}) } });
  } catch (error) { return generationHttpError(error); }
}
