export const RELATED_PETS_SNAPSHOT_DEPTH = 8;
export const RELATED_PETS_PAGE_LIMIT = 8;
export const RELATED_PETS_MARKDOWN_LIMIT = 4;

export function normalizeRelatedPetsLimit(
  value: number,
  fallback = RELATED_PETS_PAGE_LIMIT,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(
    RELATED_PETS_SNAPSHOT_DEPTH,
    Math.max(0, Math.trunc(value)),
  );
}
