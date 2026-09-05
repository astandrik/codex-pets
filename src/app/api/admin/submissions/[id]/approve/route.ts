import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { enqueueApprovalPreparation } from "@/lib/pets/approval-preparations-repository";
import { isMockPetsDataSource } from "@/lib/pets/mock-data";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-profile";
import { getRelatedPetsState } from "@/lib/pets/related-pets-repository";
import {
  getPetForApprovalPreparationById,
  moderatePet,
} from "@/lib/pets/repository";
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
  if (isMockPetsDataSource()) {
    const pet = await moderatePet({
      petId: id,
      reviewerId: principal.userId,
      decision: "approved",
    });
    if (!pet) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    revalidateSitemapCache();
    revalidateRelatedPetCandidatesCache();
    return NextResponse.json({ ok: true, pet });
  }
  if (process.env.PET_RELATED_PREAPPROVAL_ENABLED !== "true") {
    return NextResponse.json(
      { error: "approval_preparation_required" },
      { status: 503 },
    );
  }
  const pendingPet = await getPetForApprovalPreparationById(id);
  if (!pendingPet || pendingPet.status !== "pending") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const relatedState = await getRelatedPetsState();
  if (relatedState?.status !== "ready" || !relatedState.activeGenerationId) {
    return NextResponse.json(
      { error: "related_generation_unavailable" },
      { status: 503 },
    );
  }
  const preparation = await enqueueApprovalPreparation({
    petId: pendingPet.id,
    petSlug: pendingPet.slug,
    petUpdatedAt: pendingPet.updatedAt,
    reviewerId: principal.userId,
    rankingRevision: RELATED_PETS_V24_PROFILE.rankingRevision,
    expectedActiveGenerationId: relatedState.activeGenerationId,
    now: new Date().toISOString(),
  });
  if (!preparation) {
    return NextResponse.json(
      { error: "preparation_storage_unavailable" },
      { status: 503 },
    );
  }
  return NextResponse.json(
    {
      ok: true,
      status: "preparing",
      preparationId: preparation.preparationId,
    },
    { status: 202 },
  );
}
