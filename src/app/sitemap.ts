import type { MetadataRoute } from "next";

import { toPublicUrl } from "@/lib/base-path";
import { listApprovedPets } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pets = await listApprovedPets();

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: toPublicUrl("/"),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: toPublicUrl("/submit"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];

  const petEntries: MetadataRoute.Sitemap = pets.map((pet) => ({
    url: toPublicUrl(`/pets/${pet.slug}`),
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  return [...staticEntries, ...petEntries];
}
