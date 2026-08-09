import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { rebuildRelatedPetsBestEffort } from "@/lib/pets/related-pets-rebuild-trigger";
import { softDeletePetByIdWithPreviousStatus } from "@/lib/pets/repository";
import { reopenGeneratedPetRequest } from "@/lib/pets/generation/repository";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getCurrentPrincipal();
  if (!principal || !isAdminUser(principal)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const deletion = await softDeletePetByIdWithPreviousStatus({
    petId: id,
    actorUserId: principal.userId,
    actorRole: "admin",
  });

  if (!deletion) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  await reopenGeneratedPetRequest(id);

  if (deletion.previousStatus === "approved") {
    revalidateSitemapCache();
    revalidateRelatedPetCandidatesCache();
    await rebuildRelatedPetsBestEffort({
      trigger: "admin-delete",
      includeVisual: true,
    });
  }

  return NextResponse.json({ ok: true });
}
