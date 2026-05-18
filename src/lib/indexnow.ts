import { getPublicOrigin, toPublicUrl } from "@/lib/base-path";

const DEFAULT_INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
const INDEXNOW_KEY_PATTERN = /^[A-Za-z0-9-]{8,128}$/;
const INDEXNOW_TIMEOUT_MS = 3000;
const INDEXNOW_MAX_URLS = 10_000;

export type IndexNowSubmissionResult =
  | {
      status: "submitted";
      httpStatus: number;
      urls: string[];
    }
  | {
      status: "skipped";
      reason: "missing-key" | "invalid-key" | "empty-url-list";
      urls: string[];
    }
  | {
      status: "failed";
      httpStatus?: number;
      error?: string;
      urls: string[];
    };

export function getIndexNowKey(): string | null {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key || !INDEXNOW_KEY_PATTERN.test(key)) {
    return null;
  }

  return key;
}

export function getIndexNowKeyFileName(): string | null {
  const key = getIndexNowKey();
  return key ? `${key}.txt` : null;
}

export function getIndexNowKeyLocation(): string | null {
  const fileName = getIndexNowKeyFileName();
  return fileName ? toPublicUrl(`/${fileName}`) : null;
}

export function getApprovedPetIndexNowUrls(slug: string): string[] {
  const normalizedSlug = slug.trim();
  const urls = [
    toPublicUrl("/"),
    toPublicUrl("/sitemap.xml"),
    toPublicUrl("/llms.txt"),
    toPublicUrl("/api/manifest"),
  ];

  if (normalizedSlug) {
    urls.splice(1, 0, toPublicUrl(`/pets/${encodeURIComponent(normalizedSlug)}`));
  }

  return urls;
}

export async function notifyIndexNowOfApprovedPet(
  slug: string,
): Promise<IndexNowSubmissionResult> {
  return notifyIndexNow(getApprovedPetIndexNowUrls(slug));
}

export async function notifyIndexNow(
  urls: string[],
): Promise<IndexNowSubmissionResult> {
  const key = process.env.INDEXNOW_KEY?.trim();
  if (!key) {
    return { status: "skipped", reason: "missing-key", urls: [] };
  }
  if (!INDEXNOW_KEY_PATTERN.test(key)) {
    return { status: "skipped", reason: "invalid-key", urls: [] };
  }

  let normalizedUrls: string[];
  try {
    normalizedUrls = normalizeIndexNowUrls(urls);
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "unknown error",
      urls: [],
    };
  }
  if (normalizedUrls.length === 0) {
    return { status: "skipped", reason: "empty-url-list", urls: normalizedUrls };
  }

  const keyLocation = getIndexNowKeyLocation();
  if (!keyLocation) {
    return { status: "skipped", reason: "invalid-key", urls: normalizedUrls };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INDEXNOW_TIMEOUT_MS);

  try {
    const response = await fetch(getIndexNowEndpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        host: new URL(getPublicOrigin()).host,
        key,
        keyLocation,
        urlList: normalizedUrls,
      }),
      signal: controller.signal,
    });

    if (response.ok || response.status === 202) {
      return {
        status: "submitted",
        httpStatus: response.status,
        urls: normalizedUrls,
      };
    }

    return {
      status: "failed",
      httpStatus: response.status,
      urls: normalizedUrls,
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "unknown error",
      urls: normalizedUrls,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function getIndexNowEndpoint(): string {
  return process.env.INDEXNOW_ENDPOINT?.trim() || DEFAULT_INDEXNOW_ENDPOINT;
}

function normalizeIndexNowUrls(urls: string[]): string[] {
  const host = new URL(getPublicOrigin()).host;
  const normalizedUrls = new Set<string>();

  for (const url of urls) {
    if (normalizedUrls.size >= INDEXNOW_MAX_URLS) break;

    try {
      const parsed = new URL(url);
      if (parsed.host !== host) continue;
      parsed.hash = "";
      normalizedUrls.add(parsed.href);
    } catch {
      // Skip malformed URLs rather than failing the moderation action.
    }
  }

  return Array.from(normalizedUrls);
}
