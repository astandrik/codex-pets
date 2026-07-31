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
  // Expire synchronously (not the SWR "max" profile): the markdown twin reads
  // candidates directly, so a stale entry could leak a moderated pet.
  revalidateTag(RELATED_PETS_CANDIDATES_CACHE_TAG, { expire: 0 });
}
