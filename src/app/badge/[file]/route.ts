import { NextResponse } from "next/server";

import { readSafeBadgeSlug } from "@/lib/pets/agent-dto";
import { buildBadgeSvg } from "@/lib/pets/agent-snippets";
import { getApprovedPetBySlug } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  const { file } = await params;
  const slug = readSafeBadgeSlug(file);
  if (!slug) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new Response(
    buildBadgeSvg({
      name: pet.displayName,
      kind: pet.kind,
    }),
    {
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=3600",
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
