import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { readGenerationRequestImage } from "@/lib/pets/generation-requests-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const principal = await getCurrentPrincipal();
  if (!principal) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const { id } = await params;
  const image = await readGenerationRequestImage(id);
  if (!image) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const canRead =
    isAdminUser(principal) || image.requesterUserId === principal.userId;
  if (!canRead) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(image.buffer), {
    status: 200,
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `inline; filename="${escapeHeaderValue(image.fileName)}"`,
    },
  });
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}
