const EXCLUDED_TAGS = new Set([
  "cc0",
  "public-domain",
  "sprite",
  "spritesheet",
]);
const TEXT_FIRST_EXCLUDED_TAGS = new Set([
  ...EXCLUDED_TAGS,
  "detailed",
  "detaiiled",
]);

export const RELATED_PETS_THEME_QUERY_REVISION =
  "yandex-text-embeddings-v2-768-related-theme-query-2026-08-v2";
export const RELATED_PETS_DESCRIPTION_QUERY_REVISION =
  "yandex-text-embeddings-v2-768-related-description-query-2026-08-v3";
export const RELATED_PETS_DESCRIPTION_DOCUMENT_REVISION =
  "yandex-text-embeddings-v2-768-related-description-document-2026-08-v1";

export function normalizeRelatedPetSemanticTags(tags) {
  return normalizeSemanticTags(tags, EXCLUDED_TAGS);
}

export function normalizeRelatedPetTextFirstTags(tags) {
  return normalizeSemanticTags(tags, TEXT_FIRST_EXCLUDED_TAGS);
}

function normalizeSemanticTags(tags, excludedTags) {
  return Array.from(
    new Set(
      tags
        .map((tag) => tag.normalize("NFKC").trim().toLowerCase())
        .filter(
          (tag) =>
            tag.length > 0 && !isOperationalTag(tag, excludedTags),
        ),
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

export function buildRelatedPetDescriptionText(pet) {
  return [
    `name: ${pet.displayName.normalize("NFKC").trim()}`,
    `kind: ${pet.kind}`,
    `description: ${pet.description.normalize("NFKC").trim()}`,
  ].join("\n");
}

function isOperationalTag(tag, excludedTags) {
  return excludedTags.has(tag) ||
    /^v\d+$/.test(tag) ||
    tag.startsWith("license-") ||
    tag.startsWith("source-");
}

function compareCodePoints(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
