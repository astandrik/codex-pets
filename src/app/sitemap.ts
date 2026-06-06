import type { MetadataRoute } from "next";
import { unstable_cache } from "next/cache";

import { listPublicUserProfiles } from "@/lib/auth/repository";
import { toPublicUrl } from "@/lib/base-path";
import { listApprovedPets } from "@/lib/pets/repository";
import {
  SITEMAP_CACHE_TAG,
  SITEMAP_REVALIDATE_SECONDS,
} from "@/lib/sitemap-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getSitemapSnapshot = unstable_cache(
  async (): Promise<MetadataRoute.Sitemap> => {
    return buildSitemap();
  },
  [
    "codex-pets-sitemap",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
    process.env.NEXT_PUBLIC_APP_URL?.trim() || "http://localhost:3000",
    process.env.NEXT_PUBLIC_BASE_PATH?.trim() || "",
  ],
  {
    revalidate: SITEMAP_REVALIDATE_SECONDS,
    tags: [SITEMAP_CACHE_TAG],
  },
);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  return getSitemapSnapshot();
}

async function buildSitemap(): Promise<MetadataRoute.Sitemap> {
  const [pets, profiles] = await Promise.all([
    listApprovedPets(),
    listPublicUserProfiles(),
  ]);
  const generatedAt = new Date().toISOString();

  const staticEntries: MetadataRoute.Sitemap = [
    {
      url: toPublicUrl("/"),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: toPublicUrl("/about"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: toPublicUrl("/about.md"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/agents"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: toPublicUrl("/agents.md"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/pricing"),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: toPublicUrl("/pricing.md"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/terms"),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: toPublicUrl("/terms.md"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/developers"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: toPublicUrl("/developers/llms.txt"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/docs/api"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: toPublicUrl("/docs/llms.txt"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/guides/best-codex-pets-for-ai-coding-agents"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: toPublicUrl("/guides/best-codex-pets-for-ai-coding-agents.md"),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/guides/codex-pets-vs-vscode-pets"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: toPublicUrl("/guides/codex-pets-vs-vscode-pets.md"),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/guides/codex-pets-vs-openpets"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: toPublicUrl("/guides/codex-pets-vs-openpets.md"),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/guides/codex-pets-mcp-integration-guide"),
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: toPublicUrl("/guides/codex-pets-mcp-integration-guide.md"),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/index.md"),
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: toPublicUrl("/developers.md"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/docs/api.md"),
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/auth.md"),
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/mcp.md"),
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/llms-full.txt"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/openapi.json"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.5,
    },
    {
      url: toPublicUrl("/api/openapi.json"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/server.json"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/.well-known/mcp/server.json"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/.well-known/mcp"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/.well-known/mcp/server-card.json"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/.well-known/oauth-protected-resource"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/.well-known/oauth-protected-resource/mcp"),
      lastModified: generatedAt,
      changeFrequency: "weekly",
      priority: 0.4,
    },
    {
      url: toPublicUrl("/request"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: toPublicUrl("/submit"),
      changeFrequency: "weekly",
      priority: 0.7,
    },
  ];

  const petEntries: MetadataRoute.Sitemap = pets.flatMap((pet) => {
    const lastModified = toIsoDateTime(pet.approvedAt ?? pet.createdAt);

    return [
      {
        url: toPublicUrl(`/pets/${pet.slug}`),
        lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.8,
      },
      {
        url: toPublicUrl(`/pets/${pet.slug}/markdown`),
        lastModified,
        changeFrequency: "weekly" as const,
        priority: 0.5,
      },
    ];
  });

  const profileEntries: MetadataRoute.Sitemap = profiles.map((profile) => ({
    url: toPublicUrl(`/users/${profile.profileSlug}`),
    lastModified: toIsoDateTime(profile.updatedAt || profile.createdAt),
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  return [...staticEntries, ...petEntries, ...profileEntries];
}

function toIsoDateTime(value: string): string {
  return new Date(value).toISOString();
}
