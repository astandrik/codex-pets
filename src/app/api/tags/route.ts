import { NextResponse } from "next/server";

import { listApprovedPets } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const pets = await listApprovedPets();
  const counts = new Map<string, number>();

  for (const pet of pets) {
    for (const tag of pet.tags) {
      const name = tag.trim().toLowerCase();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }

  const tags = Array.from(counts, ([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));

  return NextResponse.json(
    {
      generatedAt: new Date().toISOString(),
      total: tags.length,
      tags,
    },
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
