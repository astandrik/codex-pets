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
import {
  getPetPublicEmailModerationState,
  moderatePet,
} from "@/lib/pets/repository";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
import { petSearchRuntimeConfig } from "@/lib/pets/search-provider-runtime";
import { refreshApprovedPetSearchEmbedding } from "@/lib/pets/search-runtime";
import { refreshApprovedPetVisionSearchBestEffort } from "@/lib/pets/search-vision-runtime";
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
      return NextResponse.json(
        { error: "invalid_publish_requested_email" },
        { status: 400 },
      );
    }
    publishRequestedEmail = value === true;
  }

  const { id } = await params;
  if (publishRequestedEmail) {
    const emailState = await getPetPublicEmailModerationState(id);
    if (!emailState) {
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    }
    if (!emailState.requested || !emailState.hasContactEmail) {
      return NextResponse.json(
        { error: "public_email_not_requested" },
        { status: 409 },
      );
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
