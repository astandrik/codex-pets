import { generationMutationResponse, requireGenerationAdmin } from "@/lib/pets/generation/admin-api";
import { cancelGenerationRun } from "@/lib/pets/generation/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGenerationAdmin();
  return access.ok ? generationMutationResponse(await cancelGenerationRun((await params).id)) : access.response;
}
