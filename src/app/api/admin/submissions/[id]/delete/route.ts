import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { softDeletePetById } from "@/lib/pets/repository";
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
  const deleted = await softDeletePetById({
    petId: id,
    actorUserId: principal.userId,
    actorRole: "admin",
  });

  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  revalidateSitemapCache();
  revalidateRelatedPetCandidatesCache();

  return NextResponse.json({ ok: true });
}
