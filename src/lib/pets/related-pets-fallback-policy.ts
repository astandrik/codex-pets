import { normalizeRelatedPetTopicTags } from "@/lib/pets/related-pets-semantics.mjs";

export const RELATED_PETS_V24_FALLBACK_POLICY_REVISION =
  "related-pets-zero-qualified-shared-topic-visual-v24-r1";

export function createRelatedPetTopicSet(
  tags: readonly string[],
): ReadonlySet<string> {
  return new Set(normalizeRelatedPetTopicTags(Array.from(tags)));
}

export function countSharedRelatedPetTopics(
  sourceTopics: ReadonlySet<string>,
  candidateTags: readonly string[],
): number {
  return normalizeRelatedPetTopicTags(Array.from(candidateTags)).reduce(
    (count, topic) => count + (sourceTopics.has(topic) ? 1 : 0),
    0,
  );
}
