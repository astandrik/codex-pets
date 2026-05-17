import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { readGenerationRequestAdminNote } from "@/lib/pets/generation-requests";
import { rejectGenerationRequest } from "@/lib/pets/generation-requests-repository";

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

  const body = await readJsonObject(req);
  const { id } = await params;
  const request = await rejectGenerationRequest({
    requestId: id,
    adminNote: readGenerationRequestAdminNote(body.adminNote),
  });

  if (!request) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, request });
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
