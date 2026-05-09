import { NextResponse } from "next/server";

import { toPublicUrl } from "@/lib/base-path";
import { getApprovedPetBySlug, incrementDownload } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  await incrementDownload(slug);
  const zipUrl = pet.zipUrl.startsWith("/") ? toPublicUrl(pet.zipUrl) : pet.zipUrl;
  return NextResponse.redirect(zipUrl);
}
