import { permanentRedirect } from "next/navigation";

import {
  buildGalleryHref,
  parseGalleryFilters,
  serializeGalleryFilters,
} from "@/lib/pets/gallery-filters";
import { parseCatalogPage } from "@/lib/pets/pagination";

export type PetsPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PetsPage({ searchParams }: PetsPageProps) {
  const rawSearchParams = await searchParams;
  permanentRedirect(buildRootCatalogRedirect(rawSearchParams));
}

function buildRootCatalogRedirect(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string {
  const filters = parseGalleryFilters(searchParams);
  const pageResult = parseCatalogPage(searchParams);
  const unrelatedSearch = serializeUnrelatedSearchParams(searchParams);
  if (pageResult.ok) {
    const catalogHref = buildGalleryHref({
      ...filters,
      page: pageResult.page,
    });
    return appendSearch(catalogHref, unrelatedSearch);
  }

  const pageValue = searchParams?.page;
  const rawPage = Array.isArray(pageValue) ? pageValue[0] : pageValue;
  const search = [
    serializeGalleryFilters(filters),
    `page=${encodeURIComponent(rawPage ?? "")}`,
    unrelatedSearch,
  ]
    .filter(Boolean)
    .join("&");

  return `/?${search}`;
}

const CATALOG_SEARCH_PARAMS = new Set(["q", "kind", "tags", "page"]);

function serializeUnrelatedSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string {
  const preserved = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (CATALOG_SEARCH_PARAMS.has(key)) continue;

    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) {
        preserved.append(key, item);
      }
    }
  }
  return preserved.toString();
}

function appendSearch(href: string, search: string): string {
  if (!search) return href;
  return href.includes("?") ? `${href}&${search}` : `${href}?${search}`;
}
