import {
  buildPageTitle,
  getPetMetadataDescription,
  getPetSocialImagePath,
  getSiteSocialImagePath,
  SITE_DESCRIPTION,
  SITE_IMAGE_ALT,
  SITE_NAME,
  SITE_TITLE,
} from "@/lib/site-metadata";
import { toPublicUrl } from "@/lib/base-path";
import type { ApprovalStatus, PetKind } from "@/lib/pets/types";

const PREVIEW_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
} as const;

type PreviewDocument = {
  title: string;
  description: string;
  canonicalUrl: string;
  ogUrl: string;
  ogType: "website" | "article";
  imageUrl: string;
  imageAlt: string;
  robots: string;
};

type PetPreviewInput = {
  slug: string;
  displayName: string;
  description: string;
  kind: PetKind;
  status: ApprovalStatus;
};

type PreviewPathOptions = {
  publicPath?: string;
};

export function createPreviewHtmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: PREVIEW_HEADERS,
  });
}

export function createPreviewHeadResponse(status = 200): Response {
  return new Response(null, {
    status,
    headers: PREVIEW_HEADERS,
  });
}

export function renderSitePreviewHtml(
  options: PreviewPathOptions = {},
): string {
  const publicPath = options.publicPath ?? "/";
  const pageUrl = toPublicUrl(publicPath);

  return renderPreviewHtml({
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    canonicalUrl: pageUrl,
    ogUrl: pageUrl,
    ogType: "website",
    imageUrl: toPublicUrl(getSiteSocialImagePath()),
    imageAlt: SITE_IMAGE_ALT,
    robots: "index, follow",
  });
}

export function renderPetPreviewHtml(
  pet: PetPreviewInput,
  options: PreviewPathOptions = {},
): string {
  const publicPath = options.publicPath ?? `/pets/${pet.slug}`;
  const pageUrl = toPublicUrl(publicPath);

  return renderPreviewHtml({
    title: buildPageTitle(pet.displayName),
    description: getPetMetadataDescription(
      pet.displayName,
      pet.kind,
      pet.description,
    ),
    canonicalUrl: pageUrl,
    ogUrl: pageUrl,
    ogType: "article",
    imageUrl: toPublicUrl(getPetSocialImagePath(pet.slug)),
    imageAlt: `${pet.displayName} Codex pet preview`,
    robots:
      pet.status === "approved" ? "index, follow" : "noindex, nofollow",
  });
}

function renderPreviewHtml(document: PreviewDocument): string {
  const title = escapeHtml(document.title);
  const description = escapeHtml(document.description);
  const canonicalUrl = escapeHtml(document.canonicalUrl);
  const ogUrl = escapeHtml(document.ogUrl);
  const imageUrl = escapeHtml(document.imageUrl);
  const imageAlt = escapeHtml(document.imageAlt);
  const robots = escapeHtml(document.robots);

  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    `<meta name="robots" content="${robots}">`,
    `<link rel="canonical" href="${canonicalUrl}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${ogUrl}">`,
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}">`,
    `<meta property="og:type" content="${document.ogType}">`,
    `<meta property="og:image" content="${imageUrl}">`,
    `<meta property="og:image:secure_url" content="${imageUrl}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    `<meta property="og:image:alt" content="${imageAlt}">`,
    '<meta property="og:image:type" content="image/png">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${imageUrl}">`,
    `<meta name="twitter:image:secure_url" content="${imageUrl}">`,
    '<meta name="twitter:image:width" content="1200">',
    '<meta name="twitter:image:height" content="630">',
    `<meta name="twitter:image:alt" content="${imageAlt}">`,
    '<meta name="twitter:image:type" content="image/png">',
    "</head>",
    '<body style="margin:0;font-family:system-ui,sans-serif;background:#101215;color:#f3f5f7;">',
    '<main style="max-width:760px;margin:0 auto;padding:24px;">',
    `<h1 style="margin:0 0 12px;font-size:32px;line-height:1.1;">${title}</h1>`,
    `<p style="margin:0 0 16px;font-size:18px;line-height:1.4;color:#c4ccd5;">${description}</p>`,
    `<img src="${imageUrl}" alt="${imageAlt}" width="1200" height="630" style="display:block;width:100%;height:auto;border-radius:16px;">`,
    `<p style="margin:16px 0 0;"><a href="${canonicalUrl}" style="color:#8cc7ff;">Open page</a></p>`,
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
