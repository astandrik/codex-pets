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
  if (pageResult.ok) {
    return buildGalleryHref({ ...filters, page: pageResult.page });
  }

  const pageValue = searchParams?.page;
  const rawPage = Array.isArray(pageValue) ? pageValue[0] : pageValue;
  const search = [
    serializeGalleryFilters(filters),
    `page=${encodeURIComponent(rawPage ?? "")}`,
  ]
    .filter(Boolean)
    .join("&");

  return `/?${search}`;
}
