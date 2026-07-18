export const PAGE_VIEW_METADATA_NAME = "codex-pets-page-view";

export type PageViewMetadata = {
  title: string;
  url: string;
};

export function serializePageViewMetadata(
  metadata: PageViewMetadata,
): string {
  return JSON.stringify(metadata);
}

export function parsePageViewMetadata(
  value: string | null,
): PageViewMetadata | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("title" in parsed) ||
      !("url" in parsed) ||
      typeof parsed.title !== "string" ||
      typeof parsed.url !== "string" ||
      !parsed.title ||
      !parsed.url.startsWith("/") ||
      parsed.url.startsWith("//")
    ) {
      return null;
    }

    return {
      title: parsed.title,
      url: parsed.url,
    };
  } catch {
    return null;
  }
}
