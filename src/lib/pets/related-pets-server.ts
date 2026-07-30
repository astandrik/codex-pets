import { unstable_cache } from "next/cache";

import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import { listRelatedPetCandidates } from "@/lib/pets/repository";

const getCachedRelatedPetCandidates = unstable_cache(
  async () => listRelatedPetCandidates(),
  ["pet-related-candidates"],
  { revalidate: 60 },
);

export function getRelatedPetCandidates(): Promise<RelatedPetCandidate[]> {
  return getCachedRelatedPetCandidates();
}
