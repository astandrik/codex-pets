import { beforeEach, describe, expect, it, vi } from "vitest";

const cacheMocks = vi.hoisted(() => ({
  revalidateTag: vi.fn(),
  unstableCache: vi.fn((callback: unknown) => callback),
}));

const authRepositoryMocks = vi.hoisted(() => ({
  listPublicUserProfiles: vi.fn(),
}));

const petsRepositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidateTag: cacheMocks.revalidateTag,
  unstable_cache: cacheMocks.unstableCache,
}));

vi.mock("@/lib/auth/repository", () => ({
  listPublicUserProfiles: authRepositoryMocks.listPublicUserProfiles,
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: petsRepositoryMocks.listApprovedPets,
}));

describe("sitemap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns cached static, approved pet, and public profile entries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T10:00:00.000Z"));
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");

    petsRepositoryMocks.listApprovedPets.mockResolvedValueOnce([
      {
        id: "pet_1",
        slug: "boba",
        displayName: "Boba",
        description: "Demo pet",
        spritesheetUrl: "https://assets/pets/boba.webp",
        petJsonUrl: "https://assets/pets/boba.json",
        zipUrl: "https://assets/pets/boba.zip",
        spritesheetExt: "webp",
        kind: "creature",
        tags: ["round"],
        status: "approved",
        ownerName: "Creator",
        ownerProfileSlug: "creator",
        ownerAvatarUrl: null,
        contactEmail: null,
        createdAt: "2026-05-01T00:00:00.000Z",
        approvedAt: "2026-05-02T00:00:00.000Z",
        downloadCount: 0,
        installCount: 0,
        likeCount: 0,
      },
    ]);
    authRepositoryMocks.listPublicUserProfiles.mockResolvedValueOnce([
      {
        userId: "creator@example.com",
        displayName: "Creator",
        profileSlug: "creator",
        bio: null,
        websiteUrl: null,
        githubUrl: null,
        linkedinUrl: null,
        avatarUrl: null,
        createdAt: "2026-05-03T00:00:00.000Z",
        updatedAt: "2026-05-04T00:00:00.000Z",
      },
    ]);

    try {
      const [{ default: sitemap }, sitemapCache] = await Promise.all([
        import("@/app/sitemap"),
        import("@/lib/sitemap-cache"),
      ]);

      const entries = await sitemap();

      expect(cacheMocks.unstableCache).toHaveBeenCalledWith(
        expect.any(Function),
        [
          "codex-pets-sitemap",
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
      expect(entries).toEqual([
        sitemapEntry(
          "https://pets.example/codex-pets",
          "2026-06-06T00:00:00.000Z",
          "daily",
          1,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/about",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.7,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/about.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/agents",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.7,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/agents.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/pricing",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.6,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/pricing.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/terms",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.6,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/terms.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/developers",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.7,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/developers/llms.txt",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/docs/api",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.7,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/docs/llms.txt",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/guides/best-codex-pets-for-ai-coding-agents",
          "2026-06-06T00:00:00.000Z",
          "monthly",
          0.6,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/guides/best-codex-pets-for-ai-coding-agents.md",
          "2026-06-06T00:00:00.000Z",
          "monthly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/guides/codex-pets-vs-vscode-pets",
          "2026-06-06T00:00:00.000Z",
          "monthly",
          0.6,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/guides/codex-pets-vs-vscode-pets.md",
          "2026-06-06T00:00:00.000Z",
          "monthly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/guides/codex-pets-vs-openpets",
          "2026-06-06T00:00:00.000Z",
          "monthly",
          0.6,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/guides/codex-pets-vs-openpets.md",
          "2026-06-06T00:00:00.000Z",
          "monthly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/guides/codex-pets-mcp-integration-guide",
          "2026-06-06T00:00:00.000Z",
          "monthly",
          0.6,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/guides/codex-pets-mcp-integration-guide.md",
          "2026-06-06T00:00:00.000Z",
          "monthly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/index.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.6,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/developers.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/docs/api.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/auth.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/mcp.md",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/llms-full.txt",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/openapi.json",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/api/openapi.json",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/server.json",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/.well-known/mcp/server.json",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/.well-known/mcp",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/.well-known/mcp/server-card.json",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/.well-known/oauth-protected-resource",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/.well-known/oauth-protected-resource/mcp",
          "2026-05-22T10:00:00.000Z",
          "weekly",
          0.4,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/request",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.7,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/submit",
          "2026-06-06T00:00:00.000Z",
          "weekly",
          0.7,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/pets/boba",
          "2026-05-02T00:00:00.000Z",
          "weekly",
          0.8,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/pets/boba/markdown",
          "2026-05-02T00:00:00.000Z",
          "weekly",
          0.5,
        ),
        sitemapEntry(
          "https://pets.example/codex-pets/users/creator",
          "2026-05-04T00:00:00.000Z",
          "weekly",
          0.6,
        ),
      ]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});

function sitemapEntry(
  url: string,
  lastModified: string,
  changeFrequency: string,
  priority: number,
) {
  return { url, lastModified, changeFrequency, priority };
}
