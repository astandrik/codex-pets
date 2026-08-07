import { revalidateTag, unstable_cache } from "next/cache";

import {
  selectRelatedPets,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";
import {
  normalizeRelatedPetsLimit,
  RELATED_PETS_PAGE_LIMIT,
  RELATED_PETS_SNAPSHOT_DEPTH,
} from "@/lib/pets/related-pets-limits";
import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import {
  getRelatedPetsSnapshot,
  getRelatedPetsState,
  type RelatedPetsGenerationStatus,
  type RelatedPetsSnapshot,
  type RelatedPetsState,
} from "@/lib/pets/related-pets-repository";
import {
  listApprovedPetsBySlugs,
  listRelatedPetCandidates,
} from "@/lib/pets/repository";
import type { PublicPet } from "@/lib/pets/types";

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

export type RelatedPetsResolverDiagnostic =
  | {
      operation: "resolve";
      status: "heuristic";
      reason: "invalid-enabled-flag" | "state-read-failed";
    }
  | {
      operation: "state-fallback";
      status: "heuristic";
      reason:
        | "state-not-ready"
        | "state-missing"
        | "active-generation-missing"
        | "ranking-revision-incompatible";
      generationCategory: "active" | "missing";
      generationStatus: RelatedPetsGenerationStatus | "missing";
    }
  | {
      operation: "snapshot-read";
      status: "ready" | "heuristic";
      reason:
        | "snapshot-current"
        | "snapshot-missing"
        | "snapshot-incompatible"
        | "snapshot-read-failed";
      generationCategory: "active";
      generationId: string;
      generationStatus: "ready";
      durationMs: number;
    };

export type RelatedPetsResolverLogLevel = "info" | "warn";

export type RelatedPetsResolverDependencies = {
  getCandidates: () => Promise<RelatedPetCandidate[]>;
  getState: () => Promise<RelatedPetsState | null>;
  getSnapshot: (
    generationId: string,
    sourceSlug: string,
  ) => Promise<RelatedPetsSnapshot | null>;
  getHybridEnabledValue: () => string | undefined;
  nowMs: () => number;
  log: (
    level: RelatedPetsResolverLogLevel,
    diagnostic: RelatedPetsResolverDiagnostic,
  ) => void;
};

export function createRelatedPetsResolver(
  dependencies: RelatedPetsResolverDependencies,
): (current: RelatedPetSource) => Promise<RelatedPetCandidate[]> {
  return async (current) => {
    const candidates = uniqueApprovedCandidates(
      await dependencies.getCandidates(),
      current.slug,
    );
    const heuristic = selectRelatedPets(
      candidates,
      current,
      RELATED_PETS_SNAPSHOT_DEPTH,
    );
    const enabledValue = dependencies.getHybridEnabledValue();
    if (enabledValue === "false") return heuristic;
    if (enabledValue !== undefined && enabledValue !== "true") {
      dependencies.log("warn", {
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
      dependencies.log("warn", {
        operation: "resolve",
        status: "heuristic",
        reason: "state-read-failed",
      });
      return heuristic;
    }
    if (!state) {
      dependencies.log("warn", {
        operation: "state-fallback",
        status: "heuristic",
        reason: "state-missing",
        generationCategory: "missing",
        generationStatus: "missing",
      });
      return heuristic;
    }
    const activeGenerationId = state?.activeGenerationId;
    if (state.status !== "ready") {
      dependencies.log("warn", {
        operation: "state-fallback",
        status: "heuristic",
        reason: "state-not-ready",
        generationCategory: activeGenerationId ? "active" : "missing",
        generationStatus: state.status,
      });
      return heuristic;
    }
    if (!activeGenerationId) {
      dependencies.log("warn", {
        operation: "state-fallback",
        status: "heuristic",
        reason: "active-generation-missing",
        generationCategory: "missing",
        generationStatus: "ready",
      });
      return heuristic;
    }
    if (
      state.rankingRevision !==
      CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision
    ) {
      dependencies.log("warn", {
        operation: "state-fallback",
        status: "heuristic",
        reason: "ranking-revision-incompatible",
        generationCategory: "active",
        generationStatus: "ready",
      });
      return heuristic;
    }
    const diagnosticGenerationId =
      sanitizeRelatedPetsGenerationId(activeGenerationId);

    let snapshot: RelatedPetsSnapshot | null;
    const snapshotReadStartedAt = dependencies.nowMs();
    try {
      snapshot = await dependencies.getSnapshot(
        activeGenerationId,
        current.slug,
      );
    } catch {
      dependencies.log("warn", {
        operation: "snapshot-read",
        status: "heuristic",
        reason: "snapshot-read-failed",
        generationCategory: "active",
        generationId: diagnosticGenerationId,
        generationStatus: "ready",
        durationMs: snapshotReadDuration(
          snapshotReadStartedAt,
          dependencies.nowMs(),
        ),
      });
      return heuristic;
    }
    const durationMs = snapshotReadDuration(
      snapshotReadStartedAt,
      dependencies.nowMs(),
    );
    if (!snapshot) {
      dependencies.log("warn", {
        operation: "snapshot-read",
        status: "heuristic",
        reason: "snapshot-missing",
        generationCategory: "active",
        generationId: diagnosticGenerationId,
        generationStatus: "ready",
        durationMs,
      });
      return heuristic;
    }
    if (
      snapshot.generationId !== activeGenerationId ||
      snapshot.sourceSlug !== current.slug ||
      snapshot.rankingRevision !==
        CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision ||
      !Array.isArray(snapshot.relatedSlugs)
    ) {
      dependencies.log("warn", {
        operation: "snapshot-read",
        status: "heuristic",
        reason: "snapshot-incompatible",
        generationCategory: "active",
        generationId: diagnosticGenerationId,
        generationStatus: "ready",
        durationMs,
      });
      return heuristic;
    }

    dependencies.log("info", {
      operation: "snapshot-read",
      status: "ready",
      reason: "snapshot-current",
      generationCategory: "active",
      generationId: diagnosticGenerationId,
      generationStatus: "ready",
      durationMs,
    });
    return hydrateSnapshotOrder(snapshot.relatedSlugs, candidates, heuristic);
  };
}

const resolveRelatedPets = createRelatedPetsResolver({
  getCandidates: getRelatedPetCandidates,
  getState: getRelatedPetsState,
  getSnapshot: getRelatedPetsSnapshot,
  getHybridEnabledValue: () => process.env.PET_RELATED_HYBRID_ENABLED,
  nowMs: () => performance.now(),
  log: logRelatedPetsResolverDiagnostic,
});

export function logRelatedPetsResolverDiagnostic(
  level: RelatedPetsResolverLogLevel,
  diagnostic: RelatedPetsResolverDiagnostic,
): void {
  if (level === "info") {
    console.info("[codex-pets][related-pets]", diagnostic);
    return;
  }
  console.warn("[codex-pets][related-pets]", diagnostic);
}

export function getResolvedRelatedPets(
  current: RelatedPetSource,
): Promise<RelatedPetCandidate[]> {
  return resolveRelatedPets(current);
}

export async function getApprovedResolvedRelatedPets(
  current: RelatedPetSource,
  limit = RELATED_PETS_PAGE_LIMIT,
): Promise<PublicPet[]> {
  const normalizedLimit = normalizeRelatedPetsLimit(limit);
  if (normalizedLimit === 0) return [];
  const resolvedCandidates = await getResolvedRelatedPets(current);
  if (resolvedCandidates.length === 0) return [];

  const approvedPets = await listApprovedPetsBySlugs(
    resolvedCandidates.map((candidate) => candidate.slug),
  );
  const result = approvedPets.slice(0, normalizedLimit);
  if (
    approvedPets.length === resolvedCandidates.length ||
    result.length === normalizedLimit
  ) {
    return result;
  }

  const seen = new Set(approvedPets.map((pet) => pet.slug));
  const freshCandidates = uniqueApprovedCandidates(
    await listRelatedPetCandidates(),
    current.slug,
  );
  const fallbackSlugs = selectRelatedPets(
    freshCandidates,
    current,
    freshCandidates.length,
  )
    .map((candidate) => candidate.slug)
    .filter((slug) => !seen.has(slug))
    .slice(0, normalizedLimit - result.length);
  if (fallbackSlugs.length === 0) {
    return result;
  }

  const fallbackPets = await listApprovedPetsBySlugs(fallbackSlugs);
  for (const pet of fallbackPets) {
    if (seen.has(pet.slug)) continue;
    seen.add(pet.slug);
    result.push(pet);
    if (result.length === normalizedLimit) break;
  }
  return result.slice(0, normalizedLimit);
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
    if (result.length === RELATED_PETS_SNAPSHOT_DEPTH) return result;
  }

  for (const candidate of heuristic) {
    if (seen.has(candidate.slug)) continue;
    seen.add(candidate.slug);
    result.push(candidate);
    if (result.length === RELATED_PETS_SNAPSHOT_DEPTH) break;
  }
  return result;
}

function snapshotReadDuration(startedAt: number, finishedAt: number): number {
  const duration = finishedAt - startedAt;
  if (!Number.isFinite(duration)) return 0;
  return Math.min(3_600_000, Math.max(0, Math.round(duration)));
}

function sanitizeRelatedPetsGenerationId(generationId: string): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    generationId,
  )
    ? generationId
    : "invalid-generation-id";
}
