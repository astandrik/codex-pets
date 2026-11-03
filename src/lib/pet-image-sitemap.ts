import { toPublicUrl } from "@/lib/base-path";
import { getPublicPetPreviewPath } from "@/lib/pets/asset-urls";
import { parsePublicPetLookupSlug } from "@/lib/pets/public-slug";
import type { ApprovedPetSitemapEntry } from "@/lib/pets/repository";

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
}

export function buildPetImageSitemap(entries: ApprovedPetSitemapEntry[]): string {
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const entry of entries) {
    if (seen.has(entry.slug) || parsePublicPetLookupSlug(entry.slug) !== entry.slug) continue;
    if (urls.length >= 50_000) throw new Error("Image sitemap URL limit exceeded");
    seen.add(entry.slug);
    const date = new Date(entry.updatedAt ?? entry.approvedAt ?? entry.createdAt);
    const lastmod = Number.isFinite(date.getTime()) ? `<lastmod>${date.toISOString()}</lastmod>` : "";
    urls.push(`<url><loc>${escapeXml(toPublicUrl(`/pets/${entry.slug}`))}</loc>${lastmod}<image:image><image:loc>${escapeXml(toPublicUrl(getPublicPetPreviewPath(entry.slug)))}</image:loc></image:image></url>`);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.join("")}</urlset>`;
  if (Buffer.byteLength(xml, "utf8") > 50 * 1024 * 1024) {
    throw new Error("Image sitemap size limit exceeded");
  }
  return xml;
}
