import { generationMutationResponse, readIdempotencyKey, requireGenerationAdmin } from "@/lib/pets/generation/admin-api";
import { createGenerationRun } from "@/lib/pets/generation/repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireGenerationAdmin();
  if (!access.ok) return access.response;
  const key = readIdempotencyKey(req);
  if (!key.ok) return key.response;
  const result = await createGenerationRun({ requestId: (await params).id, idempotencyKey: key.value });
  return generationMutationResponse(result, 201);
}
