import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/pets/search-runtime", () => ({
  searchApprovedPets: searchMocks.searchApprovedPets,
}));
vi.mock("next/navigation", () => navigationMocks);

describe("/pets compatibility redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    searchMocks.searchApprovedPets.mockResolvedValue({
      pets: [],
      total: 0,
      mode: "lexical",
      fallbackReason: null,
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 2,
    });
  });

  it("permanently redirects the old catalog root to /", async () => {
    const { default: PetsPage } = await import("@/app/pets/page");

    await expect(
      PetsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(navigationMocks.permanentRedirect).toHaveBeenCalledWith("/");
    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
  });

  it("preserves normalized filters and a numbered page", async () => {
    const { default: PetsPage } = await import("@/app/pets/page");

    await expect(
      PetsPage({
        searchParams: Promise.resolve({
          q: "space helper",
          kind: "creature",
          tags: ["terminal", "friendly"],
          page: "2",
        }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(navigationMocks.permanentRedirect).toHaveBeenCalledWith(
      "/?q=space%20helper&kind=creature&tags=friendly,terminal&page=2",
    );
    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
  });

  it("drops explicit page 1 while preserving filters", async () => {
    const { default: PetsPage } = await import("@/app/pets/page");

    await expect(
      PetsPage({
        searchParams: Promise.resolve({ q: "space", page: "1" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(navigationMocks.permanentRedirect).toHaveBeenCalledWith(
      "/?q=space",
    );
  });

  it("preserves an invalid page for the root route to reject", async () => {
    const { default: PetsPage } = await import("@/app/pets/page");

    await expect(
      PetsPage({
        searchParams: Promise.resolve({ q: "space", page: "abc" }),
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(navigationMocks.permanentRedirect).toHaveBeenCalledWith(
      "/?q=space&page=abc",
    );
    expect(navigationMocks.notFound).not.toHaveBeenCalled();
  });
});
