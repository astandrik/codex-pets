import { revalidateTag } from "next/cache";

export const SITEMAP_CACHE_TAG = "codex-pets:sitemap";
export const SITEMAP_REVALIDATE_SECONDS = 60 * 60;

export function revalidateSitemapCache(): void {
  revalidateTag(SITEMAP_CACHE_TAG, "max");
}
