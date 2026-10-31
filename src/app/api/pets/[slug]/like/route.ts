import { NextResponse } from "next/server";

import { getPublicOrigin } from "@/lib/base-path";
import { getApprovedPetBySlug, incrementLike } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!isAllowedLikeRequest(request)) {
    return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  }

  const { slug } = await params;
  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const likeCount = await incrementLike(slug);
  return NextResponse.json({ likeCount });
}

function isAllowedLikeRequest(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site" || fetchSite === "same-site") return false;

  const expectedOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim()
    ? getPublicOrigin()
    : new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin !== null) return origin === expectedOrigin;

  const referer = request.headers.get("referer");
  if (referer !== null) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  // Non-browser clients may omit both headers; likes remain anonymous.
  return true;
}
