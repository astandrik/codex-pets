import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { enqueueApprovalPreparation } from "@/lib/pets/approval-preparations-repository";
import { isMockPetsDataSource } from "@/lib/pets/mock-data";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-profile";
import { getRelatedPetsState } from "@/lib/pets/related-pets-repository";
import {
  getPetForApprovalPreparationById,
  getPetPublicEmailModerationState,
  moderatePet,
} from "@/lib/pets/repository";
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
  let publishRequestedEmail = false;
  const rawBody = await req.text();
  if (rawBody) {
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "invalid_json" }, { status: 400 });
    }
    const value = (body as Record<string, unknown>).publishRequestedEmail;
    if (value !== undefined && typeof value !== "boolean") {
      return NextResponse.json({ error: "invalid_publish_requested_email" }, { status: 400 });
    }
    publishRequestedEmail = value === true;
  }
  const { id } = await params;
  if (isMockPetsDataSource()) {
    if (publishRequestedEmail) {
      const emailState = await getPetPublicEmailModerationState(id);
      if (!emailState) {
        return NextResponse.json({ error: "not_found" }, { status: 404 });
      }
      if (!emailState.requested || !emailState.hasContactEmail) {
        return NextResponse.json({ error: "public_email_not_requested" }, { status: 409 });
      }
    }
    const pet = await moderatePet({
      petId: id,
      reviewerId: principal.userId,
      decision: "approved",
      publishRequestedEmail,
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
  if (publishRequestedEmail && (!pendingPet.publicEmailRequested || !pendingPet.contactEmail)) {
    return NextResponse.json({ error: "public_email_not_requested" }, { status: 409 });
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
    publishRequestedEmail,
    expectedActiveGenerationId: relatedState.activeGenerationId,
    now: new Date().toISOString(),
  });
  if (!preparation) {
    return NextResponse.json(
      { error: "preparation_storage_unavailable" },
      { status: 503 },
    );
  }
  if ((preparation.publishRequestedEmail ?? false) !== publishRequestedEmail) {
    return NextResponse.json(
      { error: "approval_email_confirmation_conflict" },
      { status: 409 },
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
