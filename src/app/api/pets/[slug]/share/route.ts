import { NextResponse } from "next/server";

import { createAgentPet, readSafeAgentSlug } from "@/lib/pets/agent-dto";
import { getApprovedPetBySlug } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug: rawSlug } = await params;
  const slug = readSafeAgentSlug(rawSlug);
  if (!slug) {
    return NextResponse.json({ error: "invalid_slug" }, { status: 400 });
  }

  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const agentPet = createAgentPet(pet);
  return NextResponse.json(
    {
      pet: agentPet,
      share: {
        badge: agentPet.badge,
        embed: agentPet.embed,
        install: agentPet.install,
      },
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
