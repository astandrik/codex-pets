import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { notifyIndexNowOfApprovedPet } from "@/lib/indexnow";
import { moderatePet } from "@/lib/pets/repository";
import { refreshApprovedPetSearchEmbedding } from "@/lib/pets/search-runtime";
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

  try {
    await refreshApprovedPetSearchEmbedding(pet);
  } catch {
    console.warn("[codex-pets][pet-search-embedding]", {
      operation: "refresh",
      status: "failed",
    });
  }

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
