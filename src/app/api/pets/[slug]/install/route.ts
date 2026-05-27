import { NextResponse } from "next/server";

import { jsonApiError } from "@/lib/api-error";
import { createAgentPet, readSafeAgentSlug } from "@/lib/pets/agent-dto";
import { getApprovedPetBySlug, incrementInstall } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug: rawSlug } = await params;
  const slug = readSafeAgentSlug(rawSlug);
  if (!slug) {
    return jsonApiError("invalid_slug", {
      status: 400,
      message: "Pet slug is invalid.",
      hint: "Use a slug from /api/pets.",
      field: "slug",
    });
  }

  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return jsonApiError("not_found", {
      status: 404,
      message: "Approved pet not found.",
      hint: "Use /api/pets to list approved pet slugs.",
      field: "slug",
    });
  }

  const agentPet = createAgentPet(pet);
  return NextResponse.json(
    {
      slug: agentPet.slug,
      name: agentPet.name,
      install: agentPet.install,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await params;
  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return jsonApiError("not_found", {
      status: 404,
      message: "Approved pet not found.",
      hint: "Use /api/pets to list approved pet slugs.",
      field: "slug",
    });
  }

  await incrementInstall(slug);
  return NextResponse.json({ ok: true });
}
