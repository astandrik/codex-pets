import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { getApprovalPreparation } from "@/lib/pets/approval-preparations-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getCurrentPrincipal();
  if (!principal || !isAdminUser(principal)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const preparationId = new URL(request.url).searchParams.get("preparationId");
  if (!preparationId) {
    return NextResponse.json({ error: "invalid_preparation" }, { status: 400 });
  }
  const [{ id }, preparation] = await Promise.all([
    params,
    getApprovalPreparation(preparationId),
  ]);
  if (!preparation || preparation.petId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({
    preparationId: preparation.preparationId,
    status: preparation.status,
    failureCode: preparation.failureCode || null,
  });
}
