import { NextResponse } from "next/server";

import { getCurrentPrincipal } from "@/lib/auth/session";
import { softDeletePetById } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getCurrentPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const deleted = await softDeletePetById({
    petId: id,
    actorUserId: principal.userId,
    actorRole: principal.role,
  });

  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
