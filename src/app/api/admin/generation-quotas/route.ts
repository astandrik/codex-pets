import { z } from "zod";
import { quotaAdmin } from "@/lib/pets/generation/quota-admin";
import { adminQuotaAction } from "@/lib/pets/generation/quota-admin-http";
import { GenerationError } from "@/lib/pets/generation/model";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const input = z.object({ ip: z.string().min(1).max(64) }).strict();
export function POST(request: Request) {
  return adminQuotaAction(request, async body => {
    const parsed = input.safeParse(body);
    if (!parsed.success) throw new GenerationError("invalid_argument");
    return { quota: await quotaAdmin.inspect(parsed.data.ip) };
  });
}
