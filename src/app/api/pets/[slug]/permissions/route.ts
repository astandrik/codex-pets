import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { getPetBySlug } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<unknown> },
): Promise<Response> {
  const routeParams = await params;
  const slug =
    routeParams &&
    typeof routeParams === "object" &&
    "slug" in routeParams &&
    typeof routeParams.slug === "string"
      ? routeParams.slug
      : null;

  if (!slug) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [principal, pet] = await Promise.all([
    getCurrentPrincipal(),
    getPetBySlug(slug),
  ]);

  if (!pet || pet.status === "deleted") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const canOwnerDelete = Boolean(
    principal && pet.ownerId && principal.userId === pet.ownerId,
  );
  const canAdminDelete = Boolean(principal && isAdminUser(principal));

  return NextResponse.json(
    {
      canOwnerDelete,
      canAdminDelete,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}
