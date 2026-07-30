import { revalidateTag, unstable_cache } from "next/cache";

import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import { listRelatedPetCandidates } from "@/lib/pets/repository";

export const RELATED_PETS_CANDIDATES_CACHE_TAG =
  "codex-pets:related-pets-candidates";

const getCachedRelatedPetCandidates = unstable_cache(
  async () => listRelatedPetCandidates(),
  ["pet-related-candidates"],
  { revalidate: 60, tags: [RELATED_PETS_CANDIDATES_CACHE_TAG] },
);

export function getRelatedPetCandidates(): Promise<RelatedPetCandidate[]> {
  return getCachedRelatedPetCandidates();
}

export function revalidateRelatedPetCandidatesCache(): void {
  revalidateTag(RELATED_PETS_CANDIDATES_CACHE_TAG, "max");
}
