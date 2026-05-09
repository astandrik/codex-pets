import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { moderatePet } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getCurrentPrincipal();
  if (!principal || !isAdminUser(principal)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { reason?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    // Reason is optional; keep rejecting with an empty reason.
  }

  const { id } = await params;
  const pet = await moderatePet({
    petId: id,
    reviewerId: principal.userId,
    decision: "rejected",
    reason: typeof body.reason === "string" ? body.reason : "",
  });
  if (!pet) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, pet });
}
