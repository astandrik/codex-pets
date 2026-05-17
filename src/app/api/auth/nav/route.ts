import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { countOpenGenerationRequests } from "@/lib/pets/generation-requests-repository";
import { countPendingPets } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const principal = await getCurrentPrincipal();
  const pendingReviewCount =
    principal && isAdminUser(principal) ? await countPendingPets() : 0;
  const openRequestCount =
    principal && isAdminUser(principal) ? await countOpenGenerationRequests() : 0;

  return NextResponse.json(
    {
      principal,
      pendingReviewCount,
      openRequestCount,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}
