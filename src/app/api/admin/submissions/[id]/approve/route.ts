import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import { refreshApprovedPetRelatedDescriptionEmbeddings } from "@/lib/pets/related-pets-query-runtime";
import { moderatePet } from "@/lib/pets/repository";
import { revalidateRelatedPetCandidatesCache } from "@/lib/pets/related-pets-server";
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
  const [searchDocumentResult, relatedResult] = await Promise.allSettled([
    refreshApprovedPetSearchEmbedding(pet),
    refreshApprovedPetRelatedDescriptionEmbeddings(pet),
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

  if (!relatedReady) {
    console.warn("[codex-pets][related-pets-v24-refresh]", {
      operation: "refresh",
      status: "incomplete",
      ...relatedStatuses,
    });
  }
  if (!isReadyRefreshStatus(searchDocumentStatus)) {
    console.warn("[codex-pets][search-document-refresh]", {
      operation: "refresh",
      status: searchDocumentStatus,
    });
  }

  void refreshApprovedPetVisionSearchBestEffort(pet).catch(() => undefined);

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
