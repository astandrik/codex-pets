import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { getApprovalPreparation, getLatestApprovalPreparationForPet } from "@/lib/pets/approval-preparations-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getCurrentPrincipal();
  if (!principal || !isAdminUser(principal)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers });
  }
  const preparationId = new URL(request.url).searchParams.get("preparationId");
  if (preparationId !== null && !/^[a-zA-Z0-9_-]{1,128}$/.test(preparationId)) {
    return NextResponse.json({ error: "invalid_preparation" }, { status: 400, headers });
  }
  const { id } = await params;
  const preparation = preparationId
    ? await getApprovalPreparation(preparationId)
    : await getLatestApprovalPreparationForPet(id);
  if (!preparation || preparation.petId !== id) {
    return NextResponse.json({ error: "not_found" }, { status: 404, headers });
  }
  return NextResponse.json({
    preparationId: preparation.preparationId,
    status: preparation.status,
    failureCode: /^[a-z][a-z0-9_]{0,63}$/.test(preparation.failureCode) ? preparation.failureCode : null,
    attempts: preparation.attempts,
    createdAt: preparation.createdAt,
    updatedAt: preparation.updatedAt,
    nextAttemptAt: preparation.status === "retry" ? preparation.nextAttemptAt || null : null,
    leaseUntil: preparation.status === "preparing" ? preparation.leaseUntil || null : null,
  }, { headers });
}
