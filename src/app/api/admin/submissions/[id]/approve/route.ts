import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import {
  invalidateRelatedPetsBestEffort,
  isRelatedPetsTextRefreshCompatible,
  rebuildRelatedPetsBestEffort,
} from "@/lib/pets/related-pets-rebuild-trigger";
import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import { refreshApprovedPetRelatedQueryEmbedding } from "@/lib/pets/related-pets-query-runtime";
import { moderatePet } from "@/lib/pets/repository";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
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
  const [documentRefresh, queryRefresh] = await Promise.allSettled([
    refreshApprovedPetSearchEmbedding(pet),
    refreshApprovedPetRelatedQueryEmbedding(pet),
  ]);
  const documentStatus = refreshStatus(documentRefresh);
  const queryStatus = refreshStatus(queryRefresh);
  const textReady =
    isReadyRefreshStatus(documentStatus) &&
    isReadyRefreshStatus(queryStatus);
  const requiresVisual =
    CURRENT_RELATED_PETS_RANKING_PROFILE.visualMinSimilarity !== null;

  if (!textReady) {
    console.warn("[codex-pets][related-pets-text-refresh]", {
      operation: "refresh",
      status: "incomplete",
      document: documentStatus,
      query: queryStatus,
    });
  }

  if (canPublishRelatedPets) {
    if (textReady && !requiresVisual) {
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
      if (!canPublishRelatedPets || !textReady || !requiresVisual) return;
      await rebuildRelatedPetsBestEffort({
        trigger: "approve-visual",
        includeVisual: true,
      });
    },
  }).catch(() => undefined);

  const indexNow = await notifyIndexNowOfApprovedPet(pet.slug);
  if (indexNow.status === "submitted") {
    console.info("[codex-pets][indexnow]", {
      slug: pet.slug,
      status: "submitted",
      httpStatus: indexNow.httpStatus,
      urlCount: indexNow.urls.length,
    });
  } else if (indexNow.status === "failed") {
    console.warn("[codex-pets][indexnow]", {
      slug: pet.slug,
      status: "failed",
      httpStatus: indexNow.httpStatus ?? null,
      ...(indexNow.error !== undefined ? { error: "request_failed" } : {}),
      urlCount: indexNow.urls.length,
    });
  } else {
    console.info("[codex-pets][indexnow]", {
      slug: pet.slug,
      status: "skipped",
      reason: indexNow.reason,
    });
  }

  return NextResponse.json({ ok: true, pet });
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
