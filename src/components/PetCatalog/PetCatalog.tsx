"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { PetCard } from "@/components/PetCard/PetCard";
import { withBasePath } from "@/lib/base-path";
import type { PublicPetPayload } from "@/lib/pets/api-payloads";
import {
  PET_CATALOG_RANKING_HEADER,
  PET_CATALOG_SNAPSHOT_HEADER,
} from "@/lib/pets/catalog-snapshot";
import {
  buildGalleryHref,
  hasGalleryFilters,
  serializeGalleryFilters,
  type GalleryFilters,
} from "@/lib/pets/gallery-filters";
import type { PetsPaginationMetadata } from "@/lib/pets/pagination";
import "./PetCatalog.scss";

export type PaginationItem =
  | number
  | "ellipsis-start"
  | "ellipsis-end";

type PetCatalogProps = {
  initialPets: PublicPetPayload[];
  initialPage: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  snapshotVersion: string;
  rankingVersion: string;
  filters: GalleryFilters;
};

type LoadedPage = {
  page: number;
  pets: PublicPetPayload[];
};

type PetsPageResponse = {
  total: number;
  pets: PublicPetPayload[];
  pagination: PetsPaginationMetadata;
};

export function getPaginationItems(
  totalPages: number,
  currentPage: number,
): PaginationItem[] {
  if (totalPages <= 0) return [];
  if (totalPages <= 9) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const start = Math.max(2, currentPage - 2);
  const end = Math.min(totalPages - 1, currentPage + 2);
  const items: PaginationItem[] = [1];

  if (start > 2) {
    items.push("ellipsis-start");
  }
  for (let page = start; page <= end; page += 1) {
    items.push(page);
  }
  if (end < totalPages - 1) {
    items.push("ellipsis-end");
  }
  items.push(totalPages);

  return items;
}

export function PetCatalog({
  ...props
}: PetCatalogProps) {
  return (
    <PetCatalogState
      key={createInitialCatalogStateKey(props)}
      {...props}
    />
  );
}

function PetCatalogState({
  initialPets,
  initialPage,
  pageSize,
  totalItems,
  totalPages,
  snapshotVersion,
  rankingVersion,
  filters,
}: PetCatalogProps) {
  const router = useRouter();
  const filterSearch = serializeGalleryFilters(filters);
  const [pages, setPages] = useState<LoadedPage[]>([
    { page: initialPage, pets: initialPets },
  ]);
  const [activePage, setActivePage] = useState(initialPage);
  const [knownTotalItems, setKnownTotalItems] = useState(totalItems);
  const [knownTotalPages, setKnownTotalPages] = useState(totalPages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pagesContainerRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const automaticLoadUsedRef = useRef(false);

  useEffect(() => {
    requestRef.current?.abort();
    automaticLoadUsedRef.current = false;

    return () => {
      requestRef.current?.abort();
    };
  }, [
    filterSearch,
    initialPage,
    pageSize,
    totalItems,
    totalPages,
  ]);

  const lastLoadedPage = pages.at(-1)?.page ?? initialPage;
  const hasNextPage = lastLoadedPage < knownTotalPages;
  const loadedPetCount = useMemo(
    () =>
      new Set(
        pages.flatMap((loadedPage) =>
          loadedPage.pets.map((pet) => pet.slug),
        ),
      ).size,
    [pages],
  );

  const loadNextPage = useCallback(async () => {
    if (loadingRef.current || !hasNextPage) return;

    const nextPage = lastLoadedPage + 1;
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    loadingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(
        buildPetsPageApiHref(filters, nextPage, pageSize),
        {
          headers: {
            Accept: "application/json",
            [PET_CATALOG_SNAPSHOT_HEADER]: snapshotVersion,
            [PET_CATALOG_RANKING_HEADER]: rankingVersion,
          },
          signal: controller.signal,
        },
      );
      if (response.status === 409) {
        setAnnouncement("The catalog changed. Refreshing the current page.");
        router.refresh();
        return;
      }
      if (!response.ok) {
        throw new Error(`Pet catalog request failed with ${response.status}.`);
      }

      const payload: unknown = await response.json();
      if (!isPetsPageResponse(payload, nextPage)) {
        throw new Error("Pet catalog returned an invalid page.");
      }

      const knownSlugs = new Set(
        pages.flatMap((page) => page.pets.map((pet) => pet.slug)),
      );
      const appendedPets = payload.pets.filter((pet) => {
        if (knownSlugs.has(pet.slug)) return false;
        knownSlugs.add(pet.slug);
        return true;
      });
      setPages((currentPages) => {
        if (currentPages.some((page) => page.page === nextPage)) {
          return currentPages;
        }
        return [...currentPages, { page: nextPage, pets: appendedPets }];
      });
      setKnownTotalItems(payload.pagination.totalItems);
      setKnownTotalPages(payload.pagination.totalPages);
      setAnnouncement(
        `Loaded ${appendedPets.length} more ${
          appendedPets.length === 1 ? "pet" : "pets"
        }.`,
      );
    } catch (loadError) {
      if (isAbortError(loadError)) {
        return;
      }
      setError("Could not load the next page. Try again.");
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        loadingRef.current = false;
        setIsLoading(false);
      }
    }
  }, [
    filters,
    hasNextPage,
    lastLoadedPage,
    pageSize,
    pages,
    router,
    rankingVersion,
    snapshotVersion,
  ]);

  const loadNextPageManually = useCallback(() => {
    automaticLoadUsedRef.current = true;
    return loadNextPage();
  }, [loadNextPage]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (
      !sentinel ||
      !hasNextPage ||
      automaticLoadUsedRef.current ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (
          automaticLoadUsedRef.current ||
          !entries.some((entry) => entry.isIntersecting)
        ) {
          return;
        }

        automaticLoadUsedRef.current = true;
        observer.disconnect();
        void loadNextPage();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, loadNextPage]);

  useEffect(() => {
    const container = pagesContainerRef.current;
    if (!container || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visiblePages = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => Number(entry.target.getAttribute("data-catalog-page")))
          .filter(Number.isSafeInteger);
        const page = visiblePages.at(-1);
        if (!page) return;

        setActivePage(page);
        const searchParams = new URLSearchParams(window.location.search);
        if (page > 1) {
          searchParams.set("page", String(page));
        } else {
          searchParams.delete("page");
        }
        const search = searchParams.toString();
        const href = `${window.location.pathname}${search ? `?${search}` : ""}`;
        if (`${window.location.pathname}${window.location.search}` !== href) {
          window.history.replaceState(window.history.state, "", href);
        }
      },
      { rootMargin: "-20% 0px -70% 0px" },
    );

    const pageElements = container.querySelectorAll("[data-catalog-page]");
    pageElements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [filterSearch, filters, pages]);

  const paginationItems = getPaginationItems(knownTotalPages, activePage);

  return (
    <div className="pet-catalog">
      <div ref={pagesContainerRef}>
        {pages.map((loadedPage) => (
          <section
            key={loadedPage.page}
            data-catalog-page={loadedPage.page}
            aria-label={`Catalog page ${loadedPage.page}`}
            className="pet-catalog__page"
          >
            {loadedPage.pets.length > 0 ? (
              <div className="pet-grid">
                {loadedPage.pets.map((pet) => (
                  <PetCard key={pet.slug} pet={pet} />
                ))}
              </div>
            ) : loadedPage.page === 1 ? (
              <p className="pet-catalog__empty">
                {hasGalleryFilters(filters)
                  ? "No approved pets match these filters."
                  : "No approved pets yet."}
              </p>
            ) : null}
          </section>
        ))}
      </div>

      {knownTotalPages > 1 ? (
        <nav
          className="pet-catalog__pagination"
          aria-label="Pet catalog pages"
        >
          {activePage > 1 ? (
            <Link
              href={buildGalleryHref({ ...filters, page: activePage - 1 })}
              rel="prev"
              className="pet-catalog__page-link pet-catalog__page-link--edge"
            >
              Previous
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="pet-catalog__page-link pet-catalog__page-link--edge pet-catalog__page-link--disabled"
            >
              Previous
            </span>
          )}
          <span className="pet-catalog__page-numbers">
            {paginationItems.map((item) =>
              typeof item === "number" ? (
                item === activePage ? (
                  <span
                    key={item}
                    aria-current="page"
                    className="pet-catalog__page-link pet-catalog__page-link--current"
                  >
                    {item}
                  </span>
                ) : (
                  <Link
                    key={item}
                    href={buildGalleryHref({ ...filters, page: item })}
                    className="pet-catalog__page-link"
                  >
                    {item}
                  </Link>
                )
              ) : (
                <span key={item} aria-hidden="true">
                  …
                </span>
              ),
            )}
          </span>
          {activePage < knownTotalPages ? (
            <Link
              href={buildGalleryHref({ ...filters, page: activePage + 1 })}
              rel="next"
              className="pet-catalog__page-link pet-catalog__page-link--edge"
            >
              Next
            </Link>
          ) : (
            <span
              aria-disabled="true"
              className="pet-catalog__page-link pet-catalog__page-link--edge pet-catalog__page-link--disabled"
            >
              Next
            </span>
          )}
        </nav>
      ) : null}

      <div ref={sentinelRef} className="pet-catalog__sentinel" aria-hidden="true" />
      {error ? (
        <div className="pet-catalog__load-state" role="alert">
          <span>{error}</span>
          <button
            type="button"
            data-action="retry"
            onClick={() => void loadNextPage()}
            className="pet-catalog__load-button"
          >
            Retry
          </button>
        </div>
      ) : hasNextPage ? (
        <div className="pet-catalog__load-state">
          <button
            type="button"
            data-action="load-more"
            onClick={() => void loadNextPageManually()}
            disabled={isLoading}
            className="pet-catalog__load-button"
          >
            {isLoading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : knownTotalItems > 0 ? (
        <p className="pet-catalog__end">
          {loadedPetCount === knownTotalItems
            ? `All ${knownTotalItems} matching pets are loaded.`
            : `Reached the final catalog page. ${loadedPetCount} of ${knownTotalItems} matching pets shown.`}
        </p>
      ) : null}
      <p className="pet-catalog__announcement" aria-live="polite">
        {announcement
          ? `${announcement} ${loadedPetCount} of ${knownTotalItems} shown.`
          : ""}
      </p>
    </div>
  );
}

function createInitialCatalogStateKey(props: PetCatalogProps): string {
  return JSON.stringify({
    initialPets: props.initialPets,
    initialPage: props.initialPage,
    pageSize: props.pageSize,
    totalItems: props.totalItems,
    totalPages: props.totalPages,
    snapshotVersion: props.snapshotVersion,
    rankingVersion: props.rankingVersion,
    filters: serializeGalleryFilters(props.filters),
  });
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function buildPetsPageApiHref(
  filters: GalleryFilters,
  page: number,
  pageSize: number,
): string {
  const params = new URLSearchParams(serializeGalleryFilters(filters));
  params.set("page", String(page));
  params.set("pageSize", String(pageSize));
  return withBasePath(`/api/pets?${params.toString()}`);
}

function isPetsPageResponse(
  value: unknown,
  expectedPage: number,
): value is PetsPageResponse {
  if (!value || typeof value !== "object") return false;

  const response = value as Partial<PetsPageResponse>;
  return (
    Number.isInteger(response.total) &&
    Array.isArray(response.pets) &&
    response.pets.every(
      (pet) => pet && typeof pet === "object" && typeof pet.slug === "string",
    ) &&
    Boolean(response.pagination) &&
    response.pagination?.page === expectedPage &&
    Number.isInteger(response.pagination.pageSize) &&
    Number.isInteger(response.pagination.totalItems) &&
    Number.isInteger(response.pagination.totalPages) &&
    typeof response.pagination.hasNextPage === "boolean"
  );
}
