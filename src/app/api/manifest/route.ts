import { NextResponse } from "next/server";

import { listApprovedPets } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const pets = await listApprovedPets();
  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      total: pets.length,
      pets: pets.map((pet) => ({
        slug: pet.slug,
        displayName: pet.displayName,
        kind: pet.kind,
        submittedBy: pet.ownerName,
        spritesheetUrl: pet.spritesheetUrl,
        petJsonUrl: pet.petJsonUrl,
        zipUrl: pet.zipUrl,
      })),
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
