import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import {
  readGenerationRequestAdminNote,
  validatePetLookup,
} from "@/lib/pets/generation-requests";
import { fulfillGenerationRequest } from "@/lib/pets/generation-requests-repository";

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

  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const petLookup = validatePetLookup(body.petLookup);
  if (!petLookup.ok) {
    return NextResponse.json(petLookup, { status: 400 });
  }

  const { id } = await params;
  const result = await fulfillGenerationRequest({
    requestId: id,
    petLookup: petLookup.value,
    adminNote: readGenerationRequestAdminNote(body.adminNote),
  });

  if (!result.ok) {
    const status = result.error === "pet_deleted" ? 409 : 404;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ ok: true, request: result.request });
}
