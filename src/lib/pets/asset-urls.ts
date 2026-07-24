export const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

export function assetUrl(assetId: string, filename: string): string {
  return `/api/assets/${assetId}/${filename}`;
}

export function getPetPreviewUrl(spritesheetUrl: string): string | null {
  return getDerivedPetAssetUrl(spritesheetUrl, "preview.webp");
}

export function getPetIdleStripUrl(spritesheetUrl: string): string | null {
  return getDerivedPetAssetUrl(spritesheetUrl, "idle-strip.webp");
}

export function getPetAssetIdFromSpritesheetUrl(value: string): string | null {
  const pathname = getPathname(value);
  const match = pathname.match(
    /\/api\/assets\/([^/]+)\/spritesheet\.(?:webp|png)$/,
  );
  if (!match) return null;

  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function getDerivedPetAssetUrl(
  spritesheetUrl: string,
  filename: string,
): string | null {
  if (!spritesheetUrl.startsWith("/")) {
    return null;
  }

  const match = spritesheetUrl.match(
    /^(.*\/api\/assets\/[^/]+)\/spritesheet\.(?:webp|png)$/,
  );
  if (!match) {
    return null;
  }

  return `${match[1]}/${filename}`;
}

function getPathname(value: string): string {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return value;
  }

  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}
