import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import {
  invalidateRelatedPetsBestEffort,
  isRelatedPetsTextRefreshCompatible,
  rebuildRelatedPetsBestEffort,
} from "@/lib/pets/related-pets-rebuild-trigger";
import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import {
  refreshApprovedPetRelatedDocumentEmbedding,
  refreshApprovedPetRelatedQueryEmbedding,
  refreshApprovedPetRelatedV10Embeddings,
} from "@/lib/pets/related-pets-query-runtime";
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
  const searchDocumentRefresh = refreshApprovedPetSearchEmbedding(pet);
  const v10Active = isV10Strategy(
    CURRENT_RELATED_PETS_RANKING_PROFILE.strategy,
  );
  const activeQueryRefresh = v10Active
    ? Promise.resolve("skipped" as const)
    : refreshApprovedPetRelatedQueryEmbedding(pet);
  const activeDocumentRefresh = v10Active
    ? Promise.resolve("skipped" as const)
    : CURRENT_RELATED_PETS_RANKING_PROFILE.textRevision ===
        CURRENT_RELATED_PETS_RANKING_PROFILE.embeddingRevision
      ? searchDocumentRefresh
      : refreshApprovedPetRelatedDocumentEmbedding(pet);
  const [
    searchDocumentResult,
    activeQueryResult,
    activeDocumentResult,
    v10Result,
  ] =
    await Promise.allSettled([
      searchDocumentRefresh,
      activeQueryRefresh,
      activeDocumentRefresh,
      refreshApprovedPetRelatedV10Embeddings(pet),
    ]);
  const searchDocumentStatus = refreshStatus(searchDocumentResult);
  const activeQueryStatus = refreshStatus(activeQueryResult);
  const activeDocumentStatus = refreshStatus(activeDocumentResult);
  const v10Statuses = v10Result.status === "fulfilled"
    ? v10Result.value
    : {
        descriptionQuery: "failed" as const,
        descriptionDocument: "failed" as const,
        topicQuery: "failed" as const,
        topicDocument: "failed" as const,
      };
  const v10Ready = Object.values(v10Statuses).every(isReadyRefreshStatus);
  const textReady = v10Active
    ? v10Ready
    : isReadyRefreshStatus(activeQueryStatus) &&
      isReadyRefreshStatus(activeDocumentStatus);
  const requiresVisual =
    CURRENT_RELATED_PETS_RANKING_PROFILE.visualMinSimilarity !== null;

  if (!textReady) {
    console.warn("[codex-pets][related-pets-text-refresh]", {
      operation: "refresh",
      status: "incomplete",
      searchDocument: searchDocumentStatus,
      query: activeQueryStatus,
      relatedDocument: activeDocumentStatus,
    });
  }

  if (!v10Ready) {
    console.warn("[codex-pets][related-pets-v10-refresh]", {
      operation: "refresh",
      status: "incomplete",
      ...v10Statuses,
    });
  }

  if (!isReadyRefreshStatus(searchDocumentStatus)) {
    console.warn("[codex-pets][search-document-refresh]", {
      operation: "refresh",
      status: searchDocumentStatus,
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

function isV10Strategy(strategy: string): boolean {
  return strategy === "description-theme-v10";
}
