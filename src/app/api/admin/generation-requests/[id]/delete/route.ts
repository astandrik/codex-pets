import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { softDeleteGenerationRequest } from "@/lib/pets/generation-requests-repository";
import {
  cancelGenerationRun,
  guardGenerationRequestManualMutation,
} from "@/lib/pets/generation/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getCurrentPrincipal();
  if (!principal || !isAdminUser(principal)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const guard = await guardGenerationRequestManualMutation(id);
  if (!guard.ok) return NextResponse.json({ error: guard.error, message: guard.message }, { status: 409 });
  const deleted = await softDeleteGenerationRequest(id);
  if (!deleted) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (guard.runId) await cancelGenerationRun(guard.runId);

  return NextResponse.json({ ok: true });
}
