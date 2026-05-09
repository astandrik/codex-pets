import { NextResponse } from "next/server";

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
  return NextResponse.redirect(pet.zipUrl);
}
