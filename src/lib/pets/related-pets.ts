import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";
import type { PetKind } from "@/lib/pets/types";

export type RelatedPetCandidate = {
  slug: string;
  displayName: string;
  kind: PetKind;
  tags: string[];
  description: string;
  approvedAt: string | null;
  createdAt: string;
};

export type RelatedPetMetadataRanking = {
  candidate: RelatedPetCandidate;
  sharedTagCount: number;
};

export const RELATED_PET_DESCRIPTION_MAX_LENGTH = 120;

export function formatRelatedPetDescription(description: string): string {
  const line = description.replace(/\s+/g, " ").trim();
  const codePoints = Array.from(line);
  if (codePoints.length <= RELATED_PET_DESCRIPTION_MAX_LENGTH) return line;
  return `${codePoints
    .slice(0, RELATED_PET_DESCRIPTION_MAX_LENGTH - 1)
    .join("")
    .trimEnd()}…`;
}

export function selectRelatedPets(
  candidates: readonly RelatedPetCandidate[],
  current: Pick<RelatedPetCandidate, "slug" | "kind" | "tags">,
  limit = RELATED_PETS_SNAPSHOT_DEPTH,
): RelatedPetCandidate[] {
  return rankRelatedPetsByMetadata(candidates, current)
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

export function rankRelatedPetsByMetadata(
  candidates: readonly RelatedPetCandidate[],
  current: Pick<RelatedPetCandidate, "slug" | "kind" | "tags">,
): RelatedPetMetadataRanking[] {
  const currentTags = normalizeTagSet(current.tags);

  return candidates
    .filter((candidate) => candidate.slug !== current.slug)
    .map((candidate) => ({
      candidate,
      sharedTagCount: intersectionSize(
        normalizeTagSet(candidate.tags),
        currentTags,
      ),
    }))
    .sort((left, right) => {
      if (left.sharedTagCount !== right.sharedTagCount) {
        return right.sharedTagCount - left.sharedTagCount;
      }
      const leftSameKind = left.candidate.kind === current.kind ? 1 : 0;
      const rightSameKind = right.candidate.kind === current.kind ? 1 : 0;
      if (leftSameKind !== rightSameKind) {
        return rightSameKind - leftSameKind;
      }
      const dateOrder = relatedSortDate(right.candidate).localeCompare(
        relatedSortDate(left.candidate),
      );
      if (dateOrder !== 0) {
        return dateOrder;
      }
      return left.candidate.slug.localeCompare(right.candidate.slug);
    });
}

function normalizeTagSet(tags: string[]): Set<string> {
  return new Set(
    tags
      .map((tag) => tag.trim().toLowerCase())
      .filter((tag) => tag.length > 0),
  );
}

function intersectionSize(left: Set<string>, right: Set<string>): number {
  let size = 0;
  for (const value of left) {
    if (right.has(value)) size += 1;
  }
  return size;
}

function relatedSortDate(candidate: RelatedPetCandidate): string {
  return candidate.approvedAt ?? candidate.createdAt;
}
