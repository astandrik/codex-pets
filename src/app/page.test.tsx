import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
}));
const searchMocks = vi.hoisted(() => ({
  searchApprovedPets: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_cache: (callback: unknown) => callback,
}));
vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: repositoryMocks.listApprovedPets,
}));
vi.mock("@/lib/pets/search-runtime", () => ({
  searchApprovedPets: searchMocks.searchApprovedPets,
}));
vi.mock("@/components/HomePage/HomePage", () => ({
  HomePage: () => null,
}));

const newestPet = createPet("orbit-otter", "Orbit Otter");
const semanticPet = createPet("velvet-byte", "Velvet Byte");

describe("homepage pet search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    repositoryMocks.listApprovedPets.mockResolvedValue([
      newestPet,
      semanticPet,
    ]);
    searchMocks.searchApprovedPets.mockResolvedValue({
      pets: [semanticPet, newestPet],
      total: 2,
      mode: "hybrid",
      fallbackReason: null,
      durationMs: 10,
    });
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
    expect(
      (homePage?.props.pets as Array<{ slug: string }>).map((pet) => pet.slug),
    ).toEqual(["orbit-otter", "velvet-byte"]);
    expect(
      (homePage?.props.filteredPets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(["velvet-byte", "orbit-otter"]);
    expect(homePage?.props.filteredTotal).toBe(2);
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
    contactEmail: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-02T00:00:00.000Z",
    downloadCount: 0,
    installCount: 0,
    likeCount: 0,
  };
}
