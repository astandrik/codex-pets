import type { Metadata } from "next";

import { toPublicUrl, withBasePath } from "@/lib/base-path";
import {
  normalizeGalleryFilters,
  serializeGalleryFilters,
  type GalleryFilters,
} from "@/lib/pets/gallery-filters";
import type { PublicPet } from "@/lib/pets/types";

export const SITE_NAME = "Codex Pets";
export const SITE_TAGLINE = "Animated pet packs for AI coding agents";
export const SITE_TITLE = `${SITE_NAME} - ${SITE_TAGLINE}`;
export const SITE_DESCRIPTION =
  "Browse, preview, upload, and download community-made animated pet packs for Codex.";
export const SITE_IMAGE_ALT =
  "Codex Pets gallery for animated Codex companions";

export const SITE_KEYWORDS = [
  "Codex Pets",
  "Companion Gallery",
  "Codex",
  "animated pets",
  "pet packs",
  "spritesheet",
  "community gallery",
  "TOON",
];

const SAME_AS_URLS = [
  "https://github.com/astandrik/codex-pets",
  "https://www.npmjs.com/package/@astandrik/codex-pets",
  "https://glama.ai/mcp/connectors/tech.ydb-qdrant.pets/codex-pets-ydb-qdrant",
] as const;

export const SOCIAL_IMAGE = {
  path: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: SITE_IMAGE_ALT,
} as const;

export type SocialImage = {
  url: string;
  width: number;
  height: number;
  alt: string;
  secureUrl?: string;
  type?: string;
};

type SocialImageOptions = {
  includeFallback?: boolean;
};

type TwitterImageInput = string | SocialImage;
type AlternateTypes = NonNullable<NonNullable<Metadata["alternates"]>["types"]>;

export function buildPageTitle(title: string): string {
  return `${title} - ${SITE_NAME}`;
}

export function getOpenGraphImages(
  images: SocialImage[] = [],
  options: SocialImageOptions = {},
): NonNullable<
  NonNullable<Metadata["openGraph"]>["images"]
> {
  const fallbackImages =
    options.includeFallback === false
      ? []
      : [
          {
            url: normalizeSocialImageUrl(SOCIAL_IMAGE.path),
            secureUrl: normalizeSocialImageUrl(SOCIAL_IMAGE.path),
            width: SOCIAL_IMAGE.width,
            height: SOCIAL_IMAGE.height,
            alt: SOCIAL_IMAGE.alt,
            type: "image/png",
          },
        ];

  return [
    ...images.map((image) => ({
      ...image,
      url: normalizeSocialImageUrl(image.url),
      secureUrl: image.secureUrl
        ? normalizeSocialImageUrl(image.secureUrl)
        : normalizeSocialImageUrl(image.url),
    })),
    ...fallbackImages,
  ];
}

export function getTwitterImages(
  images: TwitterImageInput[] = [],
  options: SocialImageOptions = {},
): NonNullable<
  NonNullable<Metadata["twitter"]>["images"]
> {
  const fallbackImages =
    options.includeFallback === false
      ? []
      : [
          {
            url: normalizeSocialImageUrl(SOCIAL_IMAGE.path),
            secureUrl: normalizeSocialImageUrl(SOCIAL_IMAGE.path),
            alt: SOCIAL_IMAGE.alt,
            type: "image/png",
            width: SOCIAL_IMAGE.width,
            height: SOCIAL_IMAGE.height,
          },
        ];

  return [
    ...images.map((image) =>
      typeof image === "string"
        ? normalizeSocialImageUrl(image)
        : {
            ...image,
            url: normalizeSocialImageUrl(image.url),
            secureUrl: image.secureUrl
              ? normalizeSocialImageUrl(image.secureUrl)
              : normalizeSocialImageUrl(image.url),
          },
    ),
    ...fallbackImages,
  ];
}

export function getSiteSocialImagePath(): string {
  return "/opengraph-image";
}

export function getAgentResourceAlternateTypes(): AlternateTypes {
  return {
    "application/json": [
      {
        title: "OpenAPI JSON",
        url: withBasePath("/openapi.json"),
      },
      {
        title: "Public manifest JSON",
        url: withBasePath("/api/manifest"),
      },
      {
        title: "Approved pet search JSON",
        url: withBasePath("/api/pets"),
      },
    ],
    "text/toon": [
      {
        title: "Public manifest TOON",
        url: withBasePath("/api/manifest.toon"),
      },
      {
        title: "Approved pet search TOON",
        url: withBasePath("/api/pets.toon"),
      },
    ],
    "text/plain": [
      {
        title: "Full LLM context",
        url: withBasePath("/llms-full.txt"),
      },
    ],
    "text/markdown": [
      {
        title: "Codex Pets markdown homepage",
        url: withBasePath("/index.md"),
      },
      {
        title: "Codex Pets developer markdown",
        url: withBasePath("/developers.md"),
      },
      {
        title: "Codex Pets API markdown",
        url: withBasePath("/docs/api.md"),
      },
      {
        title: "Codex Pets auth markdown",
        url: withBasePath("/auth.md"),
      },
    ],
  };
}

function getGalleryResourceAlternateTypes(search: string): AlternateTypes {
  return {
    "application/json": [
      {
        title: "Filtered approved pet search JSON",
        url: withBasePath(`/api/pets?${search}`),
      },
    ],
    "text/toon": [
      {
        title: "Filtered approved pet search TOON",
        url: withBasePath(`/api/pets.toon?${search}`),
      },
    ],
  };
}

export function buildGalleryPageMetadata(filters: GalleryFilters): Metadata {
  const normalizedFilters = normalizeGalleryFilters(filters);
  const search = serializeGalleryFilters(normalizedFilters);
  if (!search) {
    return {};
  }

  const path = `/?${search}`;
  const title = getGalleryFilterTitle(normalizedFilters);
  const description = getGalleryFilterDescription(normalizedFilters);

  return {
    title,
    description,
    alternates: {
      canonical: withBasePath(path),
      types: getGalleryResourceAlternateTypes(search),
    },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      title: buildPageTitle(title),
      description,
      url: withBasePath(path),
      images: getOpenGraphImages(),
    },
    twitter: {
      card: "summary_large_image",
      title: buildPageTitle(title),
      description,
      images: getTwitterImages(),
    },
  };
}

export function getPetSocialImagePath(slug: string): string {
  return `/pets/${encodeURIComponent(slug)}/opengraph-image.png`;
}

export function getPetResourceAlternateTypes(
  slug: string,
  displayName: string,
): AlternateTypes {
  const encodedSlug = encodeURIComponent(slug);

  return {
    "application/json": [
      {
        title: `${displayName} JSON`,
        url: withBasePath(`/api/pets/${encodedSlug}`),
      },
    ],
    "text/toon": [
      {
        title: `${displayName} TOON`,
        url: withBasePath(`/api/pets/${encodedSlug}.toon`),
      },
    ],
  };
}

export function getPetMetadataDescription(
  displayName: string,
  kind: string,
  description: string,
): string {
  return truncateMetaDescription(
    `${displayName} is a ${kind} Codex pet pack. ${description}`,
  );
}

export function getWebsiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": getSiteIdentityJsonLdNodes(),
  };
}

export function getHomepageJsonLdGraph(
  featuredPets: Array<
    Pick<
      PublicPet,
      | "slug"
      | "displayName"
      | "description"
      | "kind"
      | "tags"
      | "ownerName"
      | "ownerProfileSlug"
      | "createdAt"
      | "approvedAt"
      | "zipUrl"
      | "spritesheetUrl"
      | "petJsonUrl"
    >
  > = [],
) {
  const homeUrl = toPublicUrl("/");
  const productId = `${homeUrl}#product`;
  const softwareId = `${homeUrl}#software`;
  const websiteId = `${homeUrl}#website`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${homeUrl}#webpage`,
        name: SITE_TITLE,
        url: homeUrl,
        description: SITE_DESCRIPTION,
        isPartOf: { "@id": websiteId },
        about: [{ "@id": productId }, { "@id": softwareId }],
        speakable: {
          "@type": "SpeakableSpecification",
          cssSelector: [".home-hero__lead", ".home-agent-summary"],
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${homeUrl}#faq`,
        mainEntity: [
          {
            "@type": "Question",
            name: "What is Codex Pets?",
            acceptedAnswer: {
              "@type": "Answer",
              text:
                "Codex Pets is a moderated community gallery for downloadable Codex-compatible animated pet packs.",
            },
          },
          {
            "@type": "Question",
            name: "How do agents access Codex Pets?",
            acceptedAnswer: {
              "@type": "Answer",
              text:
                "Agents can use the public OpenAPI spec, llms.txt, JSON and TOON routes, or the read-only MCP endpoint.",
            },
          },
        ],
      },
      {
        "@type": "ItemList",
        "@id": `${homeUrl}#featured-pets`,
        name: "Featured Codex pet packs",
        numberOfItems: featuredPets.length,
        itemListElement: featuredPets.map((pet, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: getPetJsonLd(pet),
        })),
      },
    ],
  };
}

function getSiteIdentityJsonLdNodes() {
  const homeUrl = toPublicUrl("/");
  const organizationId = `${homeUrl}#organization`;
  const softwareId = `${homeUrl}#software`;
  const productId = `${homeUrl}#product`;
  const websiteId = `${homeUrl}#website`;

  return [
    {
      "@type": "Organization",
      "@id": organizationId,
      name: SITE_NAME,
      url: homeUrl,
      sameAs: SAME_AS_URLS,
    },
    {
      "@type": "SoftwareApplication",
      "@id": softwareId,
      name: SITE_NAME,
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      url: homeUrl,
      description: SITE_DESCRIPTION,
      isAccessibleForFree: true,
      publisher: { "@id": organizationId },
      sameAs: SAME_AS_URLS,
    },
    {
      "@type": "Product",
      "@id": productId,
      name: SITE_NAME,
      category: "AI coding agent companion registry",
      description: SITE_DESCRIPTION,
      url: homeUrl,
      brand: { "@id": organizationId },
      isRelatedTo: { "@id": softwareId },
      sameAs: SAME_AS_URLS,
    },
    {
      "@type": "WebSite",
      "@id": websiteId,
      name: SITE_NAME,
      url: homeUrl,
      description: SITE_DESCRIPTION,
      publisher: { "@id": organizationId },
      potentialAction: {
        "@type": "SearchAction",
        target: `${toPublicUrl("/")}?q={search_term_string}`,
        "query-input": "required name=search_term_string",
      },
    },
  ];
}

export function getBreadcrumbJsonLd(
  items: Array<{ name: string; path: string }>,
) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: toPublicUrl(item.path),
    })),
  };
}

export function getPetJsonLd(
  pet: Pick<
    PublicPet,
    | "slug"
    | "displayName"
    | "description"
    | "kind"
    | "tags"
    | "ownerName"
    | "ownerProfileSlug"
    | "createdAt"
    | "approvedAt"
    | "zipUrl"
    | "spritesheetUrl"
    | "petJsonUrl"
  >,
) {
  return {
    "@context": "https://schema.org",
    "@type": "CreativeWork",
    name: pet.displayName,
    description: pet.description,
    url: toPublicUrl(`/pets/${pet.slug}`),
    identifier: pet.slug,
    genre: pet.kind,
    keywords: pet.tags,
    creator: {
      "@type": "Person",
      name: pet.ownerName ?? "Anonymous",
      ...(pet.ownerProfileSlug
        ? { url: toPublicUrl(`/users/${pet.ownerProfileSlug}`) }
        : {}),
    },
    dateCreated: pet.createdAt,
    datePublished: pet.approvedAt ?? pet.createdAt,
    isAccessibleForFree: true,
    downloadUrl: absoluteUrl(pet.zipUrl),
    encoding: [
      {
        "@type": "MediaObject",
        name: "pet.json",
        contentUrl: absoluteUrl(pet.petJsonUrl),
      },
      {
        "@type": "ImageObject",
        name: "spritesheet",
        contentUrl: absoluteUrl(pet.spritesheetUrl),
      },
    ],
  };
}

function absoluteUrl(value: string): string {
  return value.startsWith("/") ? toPublicUrl(value) : value;
}

function normalizeSocialImageUrl(value: string): string {
  return value.startsWith("/") ? toPublicUrl(value) : value;
}

function getGalleryFilterTitle(filters: GalleryFilters): string {
  const kindLabel =
    filters.kind === "all" ? "Codex pets" : `${KIND_LABELS[filters.kind]} Codex pets`;
  const parts = [kindLabel];

  if (filters.query) {
    parts.push(`matching "${filters.query}"`);
  }
  if (filters.tags.length > 0) {
    parts.push(`tagged ${formatTagList(filters.tags)}`);
  }

  return parts.join(" ");
}

function getGalleryFilterDescription(filters: GalleryFilters): string {
  const kindLabel =
    filters.kind === "all"
      ? "approved"
      : `approved ${KIND_LABELS[filters.kind].toLowerCase()}`;
  const details: string[] = [];

  if (filters.query) {
    details.push(`matching "${filters.query}"`);
  }
  if (filters.tags.length > 0) {
    details.push(`tagged ${formatTagList(filters.tags)}`);
  }

  const detailText = details.length > 0 ? ` ${details.join(" and ")}` : "";
  return truncateMetaDescription(
    `Browse ${kindLabel} Codex pet packs${detailText}. Preview animations and download ZIP-ready companions for Codex.`,
  );
}

function formatTagList(tags: readonly string[]): string {
  const formatted = tags.map((tag) => `#${tag}`);
  if (formatted.length <= 2) {
    return formatted.join(" and ");
  }

  return `${formatted.slice(0, -1).join(", ")}, and ${formatted.at(-1)}`;
}

function truncateMetaDescription(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157).trimEnd()}...`;
}

const KIND_LABELS = {
  character: "Character",
  creature: "Creature",
  object: "Object",
} as const;
