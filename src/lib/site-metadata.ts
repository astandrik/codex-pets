import type { Metadata } from "next";

import { toPublicUrl, withBasePath } from "@/lib/base-path";
import type { PublicPet } from "@/lib/pets/types";

export const SITE_NAME = "Codex Pets";
export const SITE_TAGLINE = "Animated companions for Codex";
export const SITE_TITLE = `${SITE_NAME} - ${SITE_TAGLINE}`;
export const SITE_DESCRIPTION =
  "Browse, preview, upload, and download community-made animated pet packs for Codex.";
export const SITE_IMAGE_ALT =
  "Codex Pets gallery for animated Codex companions";

export const SITE_KEYWORDS = [
  "Codex Pets",
  "Codex",
  "animated pets",
  "pet packs",
  "spritesheet",
  "community gallery",
];

export const SOCIAL_IMAGE = {
  path: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: SITE_IMAGE_ALT,
} as const;

export function buildPageTitle(title: string): string {
  return `${title} - ${SITE_NAME}`;
}

export function getOpenGraphImages(): NonNullable<
  NonNullable<Metadata["openGraph"]>["images"]
> {
  return [
    {
      url: withBasePath(SOCIAL_IMAGE.path),
      width: SOCIAL_IMAGE.width,
      height: SOCIAL_IMAGE.height,
      alt: SOCIAL_IMAGE.alt,
    },
  ];
}

export function getTwitterImages(): NonNullable<
  NonNullable<Metadata["twitter"]>["images"]
> {
  return [withBasePath(SOCIAL_IMAGE.path)];
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
