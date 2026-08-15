import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import { enqueueApprovalPreparation } from "@/lib/pets/approval-preparations-repository";
import { refreshPetRelatedAnnotation } from "@/lib/pets/related-pets-annotation-runtime";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-profile";
import { refreshApprovedPetRelatedDescriptionEmbeddings } from "@/lib/pets/related-pets-query-runtime";
import {
  invalidateRelatedPetsBestEffort,
  isRelatedPetsTextRefreshCompatible,
  rebuildRelatedPetsBestEffort,
} from "@/lib/pets/related-pets-rebuild-trigger";
import { getRelatedPetsState } from "@/lib/pets/related-pets-repository";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import {
  getPetForApprovalPreparationById,
  moderatePet,
} from "@/lib/pets/repository";
import { petSearchRuntimeConfig } from "@/lib/pets/search-provider-runtime";
import { refreshApprovedPetSearchEmbedding } from "@/lib/pets/search-runtime";
import { refreshApprovedPetVisionSearchBestEffort } from "@/lib/pets/search-vision-runtime";
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
  if (process.env.PET_RELATED_PREAPPROVAL_ENABLED === "true") {
    return enqueuePreparation(id, principal.userId);
  }

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
  const canPublishRelatedPets = isRelatedPetsTextRefreshCompatible(
    petSearchRuntimeConfig.semantic,
  );
  const [searchDocumentResult, relatedResult, annotationResult] =
    await Promise.allSettled([
      refreshApprovedPetSearchEmbedding(pet),
      refreshApprovedPetRelatedDescriptionEmbeddings(pet),
      refreshPetRelatedAnnotation(pet),
    ]);
  const searchDocumentStatus = refreshStatus(searchDocumentResult);
  const relatedStatuses = relatedResult.status === "fulfilled"
    ? relatedResult.value
    : {
        descriptionQuery: "failed" as const,
        descriptionDocument: "failed" as const,
      };
  const relatedReady = Object.values(relatedStatuses).every(
    isReadyRefreshStatus,
  );
  const annotationReady = annotationResult.status === "fulfilled";
  const inputsReady = relatedReady && annotationReady;
  const requiresVisual = RELATED_PETS_V24_PROFILE.visualMinSimilarity !== null;

  if (!inputsReady) {
    console.warn("[codex-pets][related-pets-v24-refresh]", {
      operation: "refresh",
      status: "incomplete",
      ...relatedStatuses,
      annotation: annotationReady ? "ready" : "failed",
    });
  }
  if (!isReadyRefreshStatus(searchDocumentStatus)) {
    console.warn("[codex-pets][search-document-refresh]", {
      operation: "refresh",
      status: searchDocumentStatus,
    });
  }

  if (canPublishRelatedPets) {
    if (inputsReady && !requiresVisual) {
      await rebuildRelatedPetsBestEffort({
        trigger: "approve-text",
        includeVisual: false,
      });
    }
  } else {
    await invalidateRelatedPetsBestEffort({
      trigger: "approve-text",
      reason: "text-profile-incompatible",
    });
  }

  void refreshApprovedPetVisionSearchBestEffort(pet, {
    onSuccessfulRefresh: async () => {
      if (!canPublishRelatedPets || !inputsReady || !requiresVisual) return;
      await rebuildRelatedPetsBestEffort({
        trigger: "approve-visual",
        includeVisual: true,
      });
    },
  }).catch(() => undefined);

  await notifyIndexNow(pet.slug);
  return NextResponse.json({ ok: true, pet });
}

async function enqueuePreparation(
  petId: string,
  reviewerId: string,
): Promise<Response> {
  const pendingPet = await getPetForApprovalPreparationById(petId);
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
    reviewerId,
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

async function notifyIndexNow(slug: string): Promise<void> {
  const indexNow = await notifyIndexNowOfApprovedPet(slug);
  if (indexNow.status === "submitted") {
    console.info("[codex-pets][indexnow]", {
      slug,
      status: "submitted",
      httpStatus: indexNow.httpStatus,
      urlCount: indexNow.urls.length,
    });
  } else if (indexNow.status === "failed") {
    console.warn("[codex-pets][indexnow]", {
      slug,
      status: "failed",
      httpStatus: indexNow.httpStatus ?? null,
      ...(indexNow.error !== undefined ? { error: "request_failed" } : {}),
      urlCount: indexNow.urls.length,
    });
  } else {
    console.info("[codex-pets][indexnow]", {
      slug,
      status: "skipped",
      reason: indexNow.reason,
    });
  }
}

type RefreshStatus = "updated" | "unchanged" | "skipped" | "failed";

function refreshStatus(
  result: PromiseSettledResult<"updated" | "unchanged" | "skipped">,
): RefreshStatus {
  return result.status === "fulfilled" ? result.value : "failed";
}

function isReadyRefreshStatus(
  status: RefreshStatus,
): status is "updated" | "unchanged" {
  return status === "updated" || status === "unchanged";
}
