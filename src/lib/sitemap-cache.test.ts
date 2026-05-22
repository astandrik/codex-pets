import { describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: cacheMocks.revalidateTag,
}));

import {
  revalidateSitemapCache,
  SITEMAP_CACHE_TAG,
  SITEMAP_REVALIDATE_SECONDS,
} from "@/lib/sitemap-cache";

describe("sitemap cache helpers", () => {
  it("marks the sitemap cache stale without forcing blocking regeneration", () => {
    revalidateSitemapCache();

    expect(SITEMAP_REVALIDATE_SECONDS).toBe(3600);
    expect(cacheMocks.revalidateTag).toHaveBeenCalledWith(
      SITEMAP_CACHE_TAG,
      "max",
    );
  });
});
