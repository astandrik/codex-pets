import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findInternalSearchFieldPaths,
} from "@/lib/pets/search-public-contract";

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
const semanticPet = createPet("velvet-luma", "Velvet Luma");

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
      visualMode: "hybrid",
      visualFallbackReason: null,
      visualCandidateCount: 1,
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
    ).toEqual(["orbit-otter", "velvet-luma"]);
    expect(
      (homePage?.props.filteredPets as Array<{ slug: string }>).map(
        (pet) => pet.slug,
      ),
    ).toEqual(["velvet-luma", "orbit-otter"]);
    expect(homePage?.props.filteredTotal).toBe(2);
    expect(findInternalSearchFieldPaths(homePage?.props)).toEqual([]);
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
    internalSearch: {
      captionEnvelope: { accessories: "internal accessory" },
      sourceHash: "internal-source-hash",
      provenance: "visual-v2",
      scores: [0.99],
      prompt: "internal prompt",
    },
  };
}
