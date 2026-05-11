import { NextResponse } from "next/server";

import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { countPendingPets } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const principal = await getCurrentPrincipal();
  const pendingReviewCount =
    principal && isAdminUser(principal) ? await countPendingPets() : 0;

  return NextResponse.json(
    {
      principal,
      pendingReviewCount,
    },
    {
      headers: {
        "Cache-Control": "private, no-store, max-age=0, must-revalidate",
      },
    },
  );
}
