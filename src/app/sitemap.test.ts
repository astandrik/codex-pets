import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  unstableCache: vi.fn((callback: unknown) => callback),
}));

const petsRepositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
  listApprovedPetsForSearch: vi.fn(),
  listApprovedPetSitemapEntries: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: cacheMocks.revalidateTag,
  unstable_cache: cacheMocks.unstableCache,
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: petsRepositoryMocks.listApprovedPets,
  listApprovedPetsForSearch: petsRepositoryMocks.listApprovedPetsForSearch,
  listApprovedPetSitemapEntries:
    petsRepositoryMocks.listApprovedPetSitemapEntries,
}));

describe("sitemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns cached static and approved pet entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T10:00:00.000Z"));
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    const pets = Array.from({ length: 201 }, (_, index) => ({
        slug: `pet-${index + 1}`,
        createdAt: "2026-05-01T00:00:00.000Z",
        approvedAt: "2026-05-02T00:00:00.000Z",
      }));
    petsRepositoryMocks.listApprovedPetSitemapEntries.mockResolvedValueOnce(
      pets,
    );
    petsRepositoryMocks.listApprovedPetsForSearch.mockResolvedValueOnce(pets);

    try {
      const [{ default: sitemap }, sitemapCache] = await Promise.all([
        import("@/app/sitemap"),
        import("@/lib/sitemap-cache"),
      ]);

      const entries = await sitemap();

      expect(cacheMocks.unstableCache).toHaveBeenCalledWith(
        expect.any(Function),
        [
          "codex-pets-sitemap-v2",
          "mock",
          "https://pets.example/codex-pets",
          "/codex-pets",
        ],
        {
          revalidate: sitemapCache.SITEMAP_REVALIDATE_SECONDS,
          tags: [sitemapCache.SITEMAP_CACHE_TAG],
        },
      );
      const urls = entries.map((entry) => entry.url);

      expect(new Set(urls).size).toBe(urls.length);
      expect(urls.slice(0, 9)).toEqual([
        "https://pets.example/codex-pets",
        "https://pets.example/codex-pets?page=2",
        "https://pets.example/codex-pets?page=3",
        "https://pets.example/codex-pets?page=4",
        "https://pets.example/codex-pets?page=5",
        "https://pets.example/codex-pets?page=6",
        "https://pets.example/codex-pets?page=7",
        "https://pets.example/codex-pets?page=8",
        "https://pets.example/codex-pets?page=9",
      ]);
      expect(urls[9]).toBe("https://pets.example/codex-pets/about");
      expect(urls).not.toContain("https://pets.example/codex-pets/pets");
      expect(
        petsRepositoryMocks.listApprovedPetSitemapEntries,
      ).toHaveBeenCalledOnce();
      expect(
        petsRepositoryMocks.listApprovedPetsForSearch,
      ).not.toHaveBeenCalled();
      expect(petsRepositoryMocks.listApprovedPets).not.toHaveBeenCalled();
      expect(urls).toContain(
        "https://pets.example/codex-pets/pets/pet-201",
      );
      expect(entries).toContainEqual(
        sitemapEntry(
          "https://pets.example/codex-pets/pets/pet-1",
          "2026-05-02T00:00:00.000Z",
          "weekly",
          0.8,
        ),
      );
      expect(entries.some((entry) => entry.url.includes("/users/"))).toBe(false);
      expect(entries.some((entry) => "lastModified" in entry && entry.lastModified === "2026-05-22T10:00:00.000Z")).toBe(false);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  it("prefers updatedAt over approvedAt for pet lastModified", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    petsRepositoryMocks.listApprovedPetSitemapEntries.mockResolvedValueOnce([
      {
        slug: "rewritten-pet",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: "2026-07-30T12:00:00.000Z",
        approvedAt: "2026-05-02T00:00:00.000Z",
      },
      {
        slug: "untouched-pet",
        createdAt: "2026-05-01T00:00:00.000Z",
        updatedAt: null,
        approvedAt: "2026-05-03T00:00:00.000Z",
      },
    ]);

    const { default: sitemap } = await import("@/app/sitemap");
    const entries = await sitemap();

    expect(entries).toContainEqual(
      sitemapEntry(
        "https://pets.example/pets/rewritten-pet",
        "2026-07-30T12:00:00.000Z",
        "weekly",
        0.8,
      ),
    );
    expect(entries).toContainEqual(
      sitemapEntry(
        "https://pets.example/pets/untouched-pet",
        "2026-05-03T00:00:00.000Z",
        "weekly",
        0.8,
      ),
    );
  });
});

function sitemapEntry(
  url: string,
  lastModified: string | null,
  changeFrequency: string,
  priority: number,
) {
  return lastModified
    ? { url, lastModified, changeFrequency, priority }
    : { url, changeFrequency, priority };
}
