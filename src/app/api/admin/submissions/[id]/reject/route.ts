import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { rebuildRelatedPetsBestEffort } from "@/lib/pets/related-pets-rebuild-trigger";
import { moderatePetWithPreviousStatus } from "@/lib/pets/repository";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getCurrentPrincipal();
  if (!principal || !isAdminUser(principal)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { reason?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Reason is optional; keep rejecting with an empty reason.
  }

  const { id } = await params;
  const moderation = await moderatePetWithPreviousStatus({
    petId: id,
    reviewerId: principal.userId,
    decision: "rejected",
    reason: typeof body.reason === "string" ? body.reason : "",
  });
  if (!moderation) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const { pet, previousStatus } = moderation;

  revalidateSitemapCache();
  revalidateRelatedPetCandidatesCache();
  if (previousStatus === "approved") {
    await rebuildRelatedPetsBestEffort({
      trigger: "reject",
      includeVisual: true,
    });
  }

  return NextResponse.json({ ok: true, pet });
}
