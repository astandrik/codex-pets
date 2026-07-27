import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPetsForSearch: vi.fn(),
}));
const searchMocks = vi.hoisted(() => ({
  searchApprovedPets: vi.fn(),
}));
const navigationMocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));
const homePageMocks = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
const catalogMocks = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: unknown) => callback,
}));
vi.mock("@/lib/pets/repository", () => ({
  listApprovedPetsForSearch: repositoryMocks.listApprovedPetsForSearch,
}));
vi.mock("@/lib/pets/search-runtime", () => ({
  searchApprovedPets: searchMocks.searchApprovedPets,
}));
vi.mock("next/navigation", () => navigationMocks);
vi.mock("@/components/GalleryFilter/GalleryFilter", () => ({
  GalleryFilter: () => null,
}));
vi.mock("@/components/PetCatalog/PetCatalog", () => ({
  PetCatalog: (props: Record<string, unknown>) => {
    catalogMocks.props = props;
    return null;
  },
}));
vi.mock("@/components/HomePage/HomePage", () => ({
  HomePage: (props: Record<string, unknown>) => {
    homePageMocks.props = props;
    return <>{props.catalog as ReactNode}</>;
  },
}));

const approvedPets = Array.from({ length: 30 }, (_, index) =>
  createPet(`pet-${index + 1}`, `Pet ${index + 1}`),
);

describe("homepage catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    homePageMocks.props = null;
    catalogMocks.props = null;
    repositoryMocks.listApprovedPetsForSearch.mockResolvedValue(approvedPets);
    searchMocks.searchApprovedPets.mockResolvedValue({
      pets: approvedPets.slice(0, 24),
      total: approvedPets.length,
      mode: "lexical",
      fallbackReason: null,
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 2,
    });
  });

  it("renders the landing content and first 24 catalog pets on /", async () => {
    const { default: Home } = await import("@/app/page");
    const output = await Home({
      searchParams: Promise.resolve({ utm_source: "agent" }),
    });
    renderToStaticMarkup(output);

    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
    expect(homePageMocks.props).toMatchObject({
      showLandingContent: true,
      totalPets: 30,
      catalogTotalPets: 30,
    });
    expect(
      (homePageMocks.props?.pets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(approvedPets.map((pet) => pet.slug));
    expect(catalogMocks.props).toMatchObject({
      initialPage: 1,
      pageSize: 24,
      totalItems: 30,
      totalPages: 2,
    });
    expect(
      (catalogMocks.props?.initialPets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(approvedPets.slice(0, 24).map((pet) => pet.slug));
  });

  it("SSR-renders a numbered catalog page on the homepage URL", async () => {
    const { default: Home } = await import("@/app/page");

    const output = await Home({
      searchParams: Promise.resolve({ page: "2" }),
    });
    const html = renderToStaticMarkup(output);

    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
    expect(homePageMocks.props).toMatchObject({
      showLandingContent: false,
      catalogTotalPets: 30,
    });
    expect(catalogMocks.props).toMatchObject({
      initialPage: 2,
      pageSize: 24,
      totalItems: 30,
      totalPages: 2,
    });
    expect(
      (catalogMocks.props?.initialPets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(approvedPets.slice(24).map((pet) => pet.slug));
    expect(html).toContain('"@type":"CollectionPage"');
    expect(html).toContain('"position":25');
  });

  it("renders filters on page 1 without redirecting away from /", async () => {
    const { default: Home } = await import("@/app/page");

    const output = await Home({
      searchParams: Promise.resolve({
        q: "space helper",
        kind: "creature",
        tags: "friendly",
      }),
    });
    renderToStaticMarkup(output);

    expect(navigationMocks.permanentRedirect).not.toHaveBeenCalled();
    expect(searchMocks.searchApprovedPets).toHaveBeenCalledWith({
      q: "space helper",
      kind: "creature",
      tags: ["friendly"],
      offset: 0,
      limit: 24,
    });
    expect(homePageMocks.props).toMatchObject({
      showLandingContent: false,
    });
  });

  it("self-canonicalizes an unfiltered numbered homepage", async () => {
    const { generateMetadata } = await import("@/app/page");

    const metadata = await generateMetadata({
      searchParams: Promise.resolve({ page: "2" }),
    });

    expect(metadata.alternates?.canonical).toBe("/?page=2");
    expect(metadata.robots).toEqual({ index: true, follow: true });
  });

  it("permanently redirects an explicit page 1 to the root URL", async () => {
    const { default: Home } = await import("@/app/page");

    await expect(
      Home({
        searchParams: Promise.resolve({
          q: "space",
          page: "1",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(navigationMocks.permanentRedirect).toHaveBeenCalledWith(
      "/?q=space",
    );
    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.5", "abc", String(Number.MAX_SAFE_INTEGER)])(
    "returns not found for invalid page=%s",
    async (page) => {
      const { default: Home } = await import("@/app/page");

      await expect(
        Home({ searchParams: Promise.resolve({ page }) }),
      ).rejects.toThrow("NEXT_NOT_FOUND");

      expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
    },
  );

  it("returns not found for a non-empty page beyond the result set", async () => {
    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [],
      total: 48,
      mode: "lexical",
      fallbackReason: null,
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 2,
    });
    const { default: Home } = await import("@/app/page");

    await expect(
      Home({ searchParams: Promise.resolve({ page: "3" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(navigationMocks.notFound).toHaveBeenCalled();
  });

  it("keeps an empty first catalog page valid", async () => {
    repositoryMocks.listApprovedPetsForSearch.mockResolvedValueOnce([]);
    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [],
      total: 0,
      mode: "lexical",
      fallbackReason: null,
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 2,
    });
    const { default: Home } = await import("@/app/page");

    const output = await Home({
      searchParams: Promise.resolve({}),
    });
    renderToStaticMarkup(output);

    expect(navigationMocks.notFound).not.toHaveBeenCalled();
    expect(catalogMocks.props).toMatchObject({
      initialPets: [],
      initialPage: 1,
      totalItems: 0,
      totalPages: 0,
    });
  });
});

function createPet(slug: string, displayName: string) {
  return {
    id: `pet-${slug}`,
    slug,
    displayName,
    description: "Public pet",
    spritesheetUrl: `/assets/${slug}.webp`,
    petJsonUrl: `/assets/${slug}.json`,
    zipUrl: `/assets/${slug}.zip`,
    spritesheetExt: "webp" as const,
    kind: "character" as const,
    tags: ["gothic"],
    status: "approved" as const,
    ownerName: "Creator",
    ownerProfileSlug: "creator",
    ownerAvatarUrl: null,
    contactEmail: "private@example.com",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-02T00:00:00.000Z",
    downloadCount: 0,
    installCount: 0,
    likeCount: 0,
    captionJson: '{"internal":true}',
    captionText: "internal visual caption",
    sourceHash: "internal-source-hash",
  };
}
