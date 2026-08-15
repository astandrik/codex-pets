export const RELATED_PETS_V24_FALLBACK_POLICY_REVISION =
  "related-pets-zero-qualified-empty-top4-shared-topic-visual-v24-r2";

export const RELATED_PETS_V24_FALLBACK_GUARD_DEPTH = 4;

const EXCLUDED_FALLBACK_TAGS = new Set([
  "cc0",
  "public-domain",
  "sprite",
  "spritesheet",
  "detailed",
  "detaiiled",
  "girl",
  "anime",
  "chibi",
]);

export function createRelatedPetFallbackTagSet(
  tags: readonly string[],
): ReadonlySet<string> {
  return new Set(normalizeFallbackTags(tags));
}

export function countSharedRelatedPetFallbackTags(
  sourceTags: ReadonlySet<string>,
  candidateTags: readonly string[],
): number {
  return normalizeFallbackTags(candidateTags).reduce(
    (count, tag) => count + (sourceTags.has(tag) ? 1 : 0),
    0,
  );
}

function normalizeFallbackTags(tags: readonly string[]): string[] {
  return Array.from(new Set(tags
    .map((tag) => tag.normalize("NFKC").trim().toLowerCase())
    .filter((tag) =>
      tag.length > 0 &&
      !EXCLUDED_FALLBACK_TAGS.has(tag) &&
      !/^v\d+$/.test(tag) &&
      !tag.startsWith("license-") &&
      !tag.startsWith("source-")
    )))
    .toSorted(compareCodePoints);
}

function compareCodePoints(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
