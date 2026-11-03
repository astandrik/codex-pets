import { buildPetImageSitemap } from "@/lib/pet-image-sitemap";
import { listApprovedPetSitemapEntries } from "@/lib/pets/repository";
import { isMockPetsDataSource } from "@/lib/pets/mock-data";
import { isYdbConfigured } from "@/lib/ydb/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(): Promise<Response> {
  try {
    if (!isMockPetsDataSource() && !isYdbConfigured()) throw new Error("unavailable");
    const entries = await listApprovedPetSitemapEntries({ requireComplete: true });
    return new Response(buildPetImageSitemap(entries), {
      headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return new Response("Sitemap unavailable", {
      status: 503,
      headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
    });
  }
}
