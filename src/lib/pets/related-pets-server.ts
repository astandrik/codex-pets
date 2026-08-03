import { revalidateTag, unstable_cache } from "next/cache";

import {
  selectRelatedPets,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";
import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import {
  getRelatedPetsSnapshot,
  getRelatedPetsState,
  type RelatedPetsSnapshot,
  type RelatedPetsState,
} from "@/lib/pets/related-pets-repository";
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

type RelatedPetSource = Pick<
  RelatedPetCandidate,
  "slug" | "kind" | "tags"
>;

type RelatedPetsResolverDiagnostic = {
  operation: "resolve";
  status: "heuristic";
  reason:
    | "invalid-enabled-flag"
    | "state-read-failed"
    | "snapshot-read-failed";
};

export type RelatedPetsResolverDependencies = {
  getCandidates: () => Promise<RelatedPetCandidate[]>;
  getState: () => Promise<RelatedPetsState | null>;
  getSnapshot: (
    generationId: string,
    sourceSlug: string,
  ) => Promise<RelatedPetsSnapshot | null>;
  getHybridEnabledValue: () => string | undefined;
  log: (diagnostic: RelatedPetsResolverDiagnostic) => void;
};

export function createRelatedPetsResolver(
  dependencies: RelatedPetsResolverDependencies,
): (current: RelatedPetSource) => Promise<RelatedPetCandidate[]> {
  return async (current) => {
    const candidates = uniqueApprovedCandidates(
      await dependencies.getCandidates(),
      current.slug,
    );
    const heuristic = selectRelatedPets(candidates, current, 4);
    const enabledValue = dependencies.getHybridEnabledValue();
    if (enabledValue === "false") return heuristic;
    if (enabledValue !== undefined && enabledValue !== "true") {
      dependencies.log({
        operation: "resolve",
        status: "heuristic",
        reason: "invalid-enabled-flag",
      });
      return heuristic;
    }

    let state: RelatedPetsState | null;
    try {
      state = await dependencies.getState();
    } catch {
      dependencies.log({
        operation: "resolve",
        status: "heuristic",
        reason: "state-read-failed",
      });
      return heuristic;
    }
    const activeGenerationId = state?.activeGenerationId;
    if (
      state?.status !== "ready" ||
      !activeGenerationId ||
      state.rankingRevision !==
        CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision
    ) {
      return heuristic;
    }

    let snapshot: RelatedPetsSnapshot | null;
    try {
      snapshot = await dependencies.getSnapshot(
        activeGenerationId,
        current.slug,
      );
    } catch {
      dependencies.log({
        operation: "resolve",
        status: "heuristic",
        reason: "snapshot-read-failed",
      });
      return heuristic;
    }
    if (
      !snapshot ||
      snapshot.generationId !== activeGenerationId ||
      snapshot.sourceSlug !== current.slug ||
      snapshot.rankingRevision !==
        CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision ||
      !Array.isArray(snapshot.relatedSlugs)
    ) {
      return heuristic;
    }

    return hydrateSnapshotOrder(snapshot.relatedSlugs, candidates, heuristic);
  };
}

const resolveRelatedPets = createRelatedPetsResolver({
  getCandidates: getRelatedPetCandidates,
  getState: getRelatedPetsState,
  getSnapshot: getRelatedPetsSnapshot,
  getHybridEnabledValue: () => process.env.PET_RELATED_HYBRID_ENABLED,
  log: (diagnostic) => {
    console.warn("[codex-pets][related-pets]", diagnostic);
  },
});

export function getResolvedRelatedPets(
  current: RelatedPetSource,
): Promise<RelatedPetCandidate[]> {
  return resolveRelatedPets(current);
}

export function revalidateRelatedPetCandidatesCache(): void {
  // Expire synchronously (not the SWR "max" profile): the markdown twin reads
  // candidates directly, so a stale entry could leak a moderated pet.
  revalidateTag(RELATED_PETS_CANDIDATES_CACHE_TAG, { expire: 0 });
}

function uniqueApprovedCandidates(
  candidates: RelatedPetCandidate[],
  sourceSlug: string,
): RelatedPetCandidate[] {
  const seen = new Set<string>([sourceSlug]);
  return candidates.filter((candidate) => {
    if (!candidate.slug || seen.has(candidate.slug)) return false;
    seen.add(candidate.slug);
    return true;
  });
}

function hydrateSnapshotOrder(
  relatedSlugs: unknown[],
  candidates: RelatedPetCandidate[],
  heuristic: RelatedPetCandidate[],
): RelatedPetCandidate[] {
  const candidatesBySlug = new Map(
    candidates.map((candidate) => [candidate.slug, candidate]),
  );
  const result: RelatedPetCandidate[] = [];
  const seen = new Set<string>();

  for (const slug of relatedSlugs) {
    if (typeof slug !== "string" || seen.has(slug)) continue;
    const candidate = candidatesBySlug.get(slug);
    if (!candidate) continue;
    seen.add(slug);
    result.push(candidate);
    if (result.length === 4) return result;
  }

  for (const candidate of heuristic) {
    if (seen.has(candidate.slug)) continue;
    seen.add(candidate.slug);
    result.push(candidate);
    if (result.length === 4) break;
  }
  return result;
}
