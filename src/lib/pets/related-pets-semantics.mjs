const EXCLUDED_TAGS = new Set([
  "cc0",
  "public-domain",
  "sprite",
  "spritesheet",
]);

export const RELATED_PETS_THEME_QUERY_REVISION =
  "yandex-text-embeddings-v2-768-related-theme-query-2026-08-v2";

export function normalizeRelatedPetSemanticTags(tags) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.normalize("NFKC").trim().toLowerCase())
        .filter((tag) => tag.length > 0 && !isOperationalTag(tag)),
    ),
  ).sort(compareCodePoints);
}

export function buildRelatedPetThemeQuery(pet) {
  const name = pet.displayName.normalize("NFKC").trim();
  const topics = normalizeRelatedPetSemanticTags(pet.tags);
  const lines = [`name: ${name}`, `kind: ${pet.kind}`];

  if (topics.length > 0) {
    lines.push(`topics: ${topics.join(", ")}`);
  } else {
    lines.push(`description: ${pet.description.normalize("NFKC").trim()}`);
  }

  return lines.join("\n");
}

function isOperationalTag(tag) {
  return EXCLUDED_TAGS.has(tag) ||
    /^v\d+$/.test(tag) ||
    tag.startsWith("license-") ||
    tag.startsWith("source-");
}

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
