import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  countApprovedPets: vi.fn(),
  listApprovedPets: vi.fn(),
}));
const searchMocks = vi.hoisted(() => ({
  searchApprovedPets: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: unknown) => callback,
}));
vi.mock("@/lib/pets/repository", () => ({
  countApprovedPets: repositoryMocks.countApprovedPets,
  listApprovedPets: repositoryMocks.listApprovedPets,
}));
vi.mock("@/lib/pets/search-runtime", () => ({
  searchApprovedPets: searchMocks.searchApprovedPets,
}));
vi.mock("@/components/HomePage/HomePage", () => ({
  HomePage: () => null,
}));

const newestPet = createPet("orbit-otter", "Orbit Otter");
const semanticPet = createPet("velvet-luma", "Velvet Luma");

describe("homepage pet search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    repositoryMocks.listApprovedPets.mockResolvedValue([
      newestPet,
      semanticPet,
    ]);
    repositoryMocks.countApprovedPets.mockResolvedValue(201);
    searchMocks.searchApprovedPets.mockResolvedValue({
      pets: [semanticPet, newestPet],
      total: 7,
      mode: "hybrid",
      fallbackReason: null,
      visualMode: "hybrid",
      visualFallbackReason: null,
      visualCandidateCount: 1,
      durationMs: 10,
    });
  });

  it("uses the cached snapshot with an uncapped total when q is absent", async () => {
    const { default: Home } = await import("@/app/page");
    const output = await Home({
      searchParams: Promise.resolve({}),
    });
    const children = output.props.children as Array<{
      props: Record<string, unknown>;
    }>;
    const homePage = children[1];

    expect(repositoryMocks.listApprovedPets).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.countApprovedPets).toHaveBeenCalledTimes(1);
    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
    expect(
      (homePage?.props.pets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(["orbit-otter", "velvet-luma"]);
    expect(
      (homePage?.props.filteredPets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(["orbit-otter", "velvet-luma"]);
    expect(homePage?.props.filteredTotal).toBe(201);
  });

  it("uses the uncapped search path for filter-only views", async () => {
    repositoryMocks.listApprovedPets.mockResolvedValue([
      createPet("missing-tag", "Missing Tag", {
        kind: "character",
        tags: ["gothic"],
      }),
      createPet("wrong-kind", "Wrong Kind", {
        kind: "object",
        tags: ["gothic", "purple"],
      }),
    ]);
    const olderMatchingPet = createPet("multi-tag", "Multi Tag", {
      kind: "character",
      tags: ["gothic", "purple"],
    });
    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [olderMatchingPet],
      total: 1,
      mode: "lexical",
      fallbackReason: null,
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 5,
    });
    const { default: Home } = await import("@/app/page");
    const output = await Home({
      searchParams: Promise.resolve({
        q: "  \n ",
        kind: "character",
        tags: ["purple", "gothic"],
      }),
    });
    const children = output.props.children as Array<{
      props: Record<string, unknown>;
    }>;
    const homePage = children[1];

    expect(searchMocks.searchApprovedPets).toHaveBeenCalledWith({
      q: "",
      kind: "character",
      tags: ["gothic", "purple"],
    });
    expect(homePage?.props.query).toBe("");
    expect(
      (homePage?.props.filteredPets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(["multi-tag"]);
    expect(homePage?.props.filteredTotal).toBe(1);
  });

  it("renders the unified search order while keeping the full gallery snapshot", async () => {
    const { default: Home } = await import("@/app/page");
    const output = await Home({
      searchParams: Promise.resolve({ q: "sexy", kind: "character" }),
    });
    const children = output.props.children as Array<{
      props: Record<string, unknown>;
    }>;
    const homePage = children[1];

    expect(searchMocks.searchApprovedPets).toHaveBeenCalledWith({
      q: "sexy",
      kind: "character",
      tags: [],
    });
    expect(repositoryMocks.listApprovedPets).toHaveBeenCalledTimes(1);
    expect(repositoryMocks.countApprovedPets).toHaveBeenCalledTimes(1);
    expect(searchMocks.searchApprovedPets).toHaveBeenCalledTimes(1);
    expect(
      (homePage?.props.pets as Array<{ slug: string }>).map((pet) => pet.slug),
    ).toEqual(["orbit-otter", "velvet-luma"]);
    expect(
      (homePage?.props.filteredPets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(["velvet-luma", "orbit-otter"]);
    expect(homePage?.props.filteredTotal).toBe(7);
    expect(JSON.stringify(homePage?.props)).not.toMatch(
      /captionJson|captionText|sourceHash|visualMode|visualFallbackReason/,
    );
  });
});

function createPet(
  slug: string,
  displayName: string,
  overrides: {
    kind?: "character" | "creature" | "object";
    tags?: string[];
  } = {},
) {
  return {
    id: `pet-${slug}`,
    slug,
    displayName,
    description: "Public pet",
    spritesheetUrl: `/assets/${slug}.webp`,
    petJsonUrl: `/assets/${slug}.json`,
    zipUrl: `/assets/${slug}.zip`,
    spritesheetExt: "webp" as const,
    kind: overrides.kind ?? ("character" as const),
    tags: overrides.tags ?? ["gothic"],
    status: "approved" as const,
    ownerName: "Creator",
    ownerProfileSlug: "creator",
    ownerAvatarUrl: null,
    contactEmail: null,
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
