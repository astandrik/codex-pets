import { quotaAdmin } from "@/lib/pets/generation/quota-admin";
import { adminQuotaAction } from "@/lib/pets/generation/quota-admin-http";
import { quotaGrantSchema } from "@/lib/pets/generation/quota-grants";
import { GenerationError } from "@/lib/pets/generation/model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function POST(request: Request) {
  return adminQuotaAction(request, async (body, actorId) => {
    const parsed = quotaGrantSchema.safeParse(body);
    if (!parsed.success) throw new GenerationError("invalid_argument");
    const receipt = await quotaAdmin.grant(parsed.data, actorId);
    return { receipt, quota: await quotaAdmin.inspect(parsed.data.ip) };
  });
}
