import type { Metadata } from "next";

import { toPublicUrl, withBasePath } from "@/lib/base-path";
import type { PublicPet } from "@/lib/pets/types";

export const SITE_NAME = "Companion Gallery";
export const SITE_TAGLINE = "Animated pets for Codex";
export const SITE_TITLE = `${SITE_NAME} - ${SITE_TAGLINE}`;
export const SITE_DESCRIPTION =
  "Browse, preview, upload, and download community-made animated pet packs for Codex.";
export const SITE_IMAGE_ALT =
  "Companion Gallery for animated Codex companions";

export const SITE_KEYWORDS = [
  "Companion Gallery",
  "Codex",
  "animated pets",
  "pet packs",
  "spritesheet",
  "community gallery",
  "TOON",
];

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
    "@type": "WebSite",
    name: SITE_NAME,
    url: toPublicUrl("/"),
    description: SITE_DESCRIPTION,
    potentialAction: {
      "@type": "SearchAction",
      target: `${toPublicUrl("/")}?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
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

function truncateMetaDescription(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 160) {
    return normalized;
  }

  return `${normalized.slice(0, 157).trimEnd()}...`;
}
