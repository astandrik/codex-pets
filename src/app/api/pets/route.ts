import { NextResponse } from "next/server";

import { listApprovedPets } from "@/lib/pets/repository";
import { normalizeKind } from "@/lib/pets/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? undefined;
  const rawKind = url.searchParams.get("kind");
  const kind = rawKind && rawKind !== "all" ? normalizeKind(rawKind) : "all";

  const pets = await listApprovedPets({ q, kind });
  return NextResponse.json({
    total: pets.length,
    pets,
  });
}
