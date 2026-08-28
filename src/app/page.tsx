import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { GalleryFilter } from "@/components/GalleryFilter/GalleryFilter";
import { HomePage } from "@/components/HomePage/HomePage";
import { PetCatalog } from "@/components/PetCatalog/PetCatalog";
import {
  sliceHomeGalleryPets,
} from "@/components/HomePage/recommendation-entry-points";
import { serializeJsonLd } from "@/lib/json-ld";
import { createPublicPetPayload } from "@/lib/pets/api-payloads";
import {
  buildGalleryFirstPageHref,
  buildGalleryHref,
  hasGalleryFilters,
  parseGalleryFilters,
  pickSuggestedGalleryTags,
} from "@/lib/pets/gallery-filters";
import {
  CATALOG_PAGE_SIZE,
  parseCatalogPage,
} from "@/lib/pets/pagination";
import { getApprovedPetsCatalogSnapshot } from "@/lib/pets/catalog-snapshot-server";
import { searchApprovedPets } from "@/lib/pets/search-runtime";
import type { PublicPet, PublicPetSummary } from "@/lib/pets/types";
import {
  buildCatalogPageMetadata,
  getCatalogJsonLdGraph,
  getHomepageJsonLdGraph,
} from "@/lib/site-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  searchParams,
}: HomeProps): Promise<Metadata> {
  const rawSearchParams = await searchParams;
  const pageResult = parseCatalogPage(rawSearchParams);
  const page = pageResult.ok ? pageResult.page : 1;
  const filters = parseGalleryFilters(rawSearchParams);

  return buildCatalogPageMetadata(
    filters,
    page,
    hasGalleryFilterSearchParam(rawSearchParams),
    getGalleryPageViewPath(rawSearchParams),
  );
}

export default async function Home({ searchParams }: HomeProps) {
  const rawSearchParams = await searchParams;
  const pageResult = parseCatalogPage(rawSearchParams);
  if (!pageResult.ok) {
    notFound();
  }

  const filters = parseGalleryFilters(rawSearchParams);
  if (pageResult.explicit && pageResult.page === 1) {
    permanentRedirect(buildGalleryFirstPageHref(rawSearchParams));
  }

  const offset = (pageResult.page - 1) * CATALOG_PAGE_SIZE;
  if (!Number.isSafeInteger(offset)) {
    notFound();
  }

  const {
    pets: approvedPets,
    version: snapshotVersion,
  } = await getApprovedPetsCatalogSnapshot();
  const searchResult = hasGalleryFilters(filters)
    ? await searchApprovedPets(
        {
          q: filters.query,
          kind: filters.kind,
          tags: filters.tags,
          offset,
          limit: CATALOG_PAGE_SIZE,
        },
        { catalog: approvedPets },
      )
    : null;
  const result = searchResult ?? {
    pets: approvedPets.slice(offset, offset + CATALOG_PAGE_SIZE),
    total: approvedPets.length,
    rankingVersion: snapshotVersion,
  };
  if (pageResult.page > 1 && result.pets.length === 0) {
    notFound();
  }

  const pets = approvedPets.map(toPublicPetSummary);
  const featuredPets = sliceHomeGalleryPets(pets);
  const initialPets = result.pets.map(createPublicPetPayload);
  const suggestedTags = pickSuggestedGalleryTags(
    approvedPets,
    filters.tags,
  );
  const showLandingContent = pageResult.page === 1;
  const homepageJsonLd = showLandingContent
    ? getHomepageJsonLdGraph(featuredPets)
    : null;
  const catalogJsonLd = getCatalogJsonLdGraph(
    result.pets,
    pageResult.page,
    CATALOG_PAGE_SIZE,
    result.total,
    filters,
  );

  return (
    <>
      {homepageJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(homepageJsonLd),
          }}
        />
      ) : null}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(catalogJsonLd) }}
      />
      <HomePage
        pets={pets}
        totalPets={pets.length}
        catalogTotalPets={result.total}
        showLandingContent={showLandingContent}
        catalog={
          <>
            <GalleryFilter
              defaultQuery={filters.query}
              defaultKind={filters.kind}
              defaultTags={filters.tags}
              suggestedTags={suggestedTags}
            />
            <PetCatalog
              key={buildGalleryHref({
                ...filters,
                page: pageResult.page,
              })}
              initialPets={initialPets}
              initialPage={pageResult.page}
              pageSize={CATALOG_PAGE_SIZE}
              totalItems={result.total}
              totalPages={Math.ceil(result.total / CATALOG_PAGE_SIZE)}
              snapshotVersion={snapshotVersion}
              rankingVersion={result.rankingVersion}
              filters={filters}
            />
          </>
        }
      />
    </>
  );
}

function toPublicPetSummary(pet: PublicPet): PublicPetSummary {
  return {
    id: pet.id,
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    spritesheetUrl: pet.spritesheetUrl,
    petJsonUrl: pet.petJsonUrl,
    zipUrl: pet.zipUrl,
    spritesheetExt: pet.spritesheetExt,
    kind: pet.kind,
    tags: pet.tags,
    status: pet.status,
    ownerName: pet.ownerName,
    ownerProfileSlug: pet.ownerProfileSlug,
    ownerAvatarUrl: pet.ownerAvatarUrl,
    publicAuthorEmail: pet.publicAuthorEmail ?? null,
    createdAt: pet.createdAt,
    approvedAt: pet.approvedAt,
    downloadCount: pet.downloadCount,
    installCount: pet.installCount,
    likeCount: pet.likeCount,
  };
}

function hasGalleryFilterSearchParam(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): boolean {
  return ["q", "tags", "kind"].some((key) =>
    Object.hasOwn(searchParams ?? {}, key),
  );
}

function getGalleryPageViewPath(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): string {
  const serialized = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item !== undefined) {
        serialized.append(key, item);
      }
    }
  }

  const search = serialized.toString();
  return search ? `/?${search}` : "/";
}
