import { NextResponse } from "next/server";

import { toPublicUrl } from "@/lib/base-path";
import { buildPetInstallCommand } from "@/lib/pets/install-command";
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
        description: pet.description,
        kind: pet.kind,
        tags: pet.tags,
        submittedBy: pet.ownerName,
        pageUrl: toPublicUrl(`/pets/${pet.slug}`),
        spritesheetUrl: pet.spritesheetUrl,
        petJsonUrl: pet.petJsonUrl,
        zipUrl: pet.zipUrl,
        installCommand: buildPetInstallCommand(pet.slug),
        createdAt: pet.createdAt,
        approvedAt: pet.approvedAt,
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
