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
      expect(entries).toEqual([
        {
          url: "https://pets.example/codex-pets",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "daily",
          priority: 1,
        },
        {
          url: "https://pets.example/codex-pets/about",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.7,
        },
        {
          url: "https://pets.example/codex-pets/about.md",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        {
          url: "https://pets.example/codex-pets/agents",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.7,
        },
        {
          url: "https://pets.example/codex-pets/agents.md",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        {
          url: "https://pets.example/codex-pets/developers",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.7,
        },
        {
          url: "https://pets.example/codex-pets/developers/llms.txt",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        {
          url: "https://pets.example/codex-pets/docs/api",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.7,
        },
        {
          url: "https://pets.example/codex-pets/docs/llms.txt",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        {
          url: "https://pets.example/codex-pets/guides/best-codex-pets-for-ai-coding-agents",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "monthly",
          priority: 0.6,
        },
        {
          url: "https://pets.example/codex-pets/guides/codex-pets-vs-vscode-pets",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "monthly",
          priority: 0.6,
        },
        {
          url: "https://pets.example/codex-pets/guides/codex-pets-vs-openpets",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "monthly",
          priority: 0.6,
        },
        {
          url: "https://pets.example/codex-pets/guides/codex-pets-mcp-integration-guide",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "monthly",
          priority: 0.6,
        },
        {
          url: "https://pets.example/codex-pets/index.md",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.6,
        },
        {
          url: "https://pets.example/codex-pets/developers.md",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        {
          url: "https://pets.example/codex-pets/docs/api.md",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        {
          url: "https://pets.example/codex-pets/auth.md",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.4,
        },
        {
          url: "https://pets.example/codex-pets/mcp.md",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.4,
        },
        {
          url: "https://pets.example/codex-pets/llms-full.txt",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        {
          url: "https://pets.example/codex-pets/openapi.json",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.5,
        },
        {
          url: "https://pets.example/codex-pets/api/openapi.json",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.4,
        },
        {
          url: "https://pets.example/codex-pets/server.json",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.4,
        },
        {
          url: "https://pets.example/codex-pets/.well-known/mcp/server.json",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.4,
        },
        {
          url: "https://pets.example/codex-pets/.well-known/mcp",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.4,
        },
        {
          url: "https://pets.example/codex-pets/.well-known/mcp/server-card.json",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.4,
        },
        {
          url: "https://pets.example/codex-pets/request",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.7,
        },
        {
          url: "https://pets.example/codex-pets/submit",
          lastModified: "2026-05-22T10:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.7,
        },
        {
          url: "https://pets.example/codex-pets/pets/boba",
          lastModified: "2026-05-02T00:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.8,
        },
        {
          url: "https://pets.example/codex-pets/users/creator",
          lastModified: "2026-05-04T00:00:00.000Z",
          changeFrequency: "weekly",
          priority: 0.6,
        },
      ]);
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });
});
