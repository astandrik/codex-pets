import { createHash } from "node:crypto";

import { parsePetVisionCaption } from "./pet-vision-search-backfill.mjs";

export function selectEligibleCaptionRevisions(
  preflight,
  qwenRevision,
  deepSeekRevision,
) {
  if (
    !preflight ||
    typeof preflight !== "object" ||
    Array.isArray(preflight) ||
    preflight.modelsApi !== true ||
    preflight.qwenAvailable !== true ||
    preflight.embeddingsV2 !== true ||
    preflight.embeddingDimensions !== 768 ||
    typeof preflight.deepSeekEligible !== "boolean"
  ) {
    throw new Error("Managed search v2 preflight result is invalid.");
  }
  return [
    qwenRevision,
    ...(preflight.deepSeekEligible ? [deepSeekRevision] : []),
  ];
}

export function createBlindCaptionReviewArtifact({
  candidateRevisions,
  pets,
}) {
  if (
    candidateRevisions.length < 1 ||
    candidateRevisions.length > 2 ||
    new Set(candidateRevisions).size !== candidateRevisions.length
  ) {
    throw new Error(
      "Blind caption review requires one or two unique eligible candidates.",
    );
  }

  const captionsByRevision = new Map();
  for (const revision of candidateRevisions) {
    const parsedBySlug = new Map();
    let complete = true;
    for (const pet of pets) {
      if (!Object.hasOwn(pet.captions, revision)) {
        complete = false;
        break;
      }
      try {
        parsedBySlug.set(
          pet.slug,
          parsePetVisionCaption(pet.captions[revision]),
        );
      } catch {
        complete = false;
        break;
      }
    }
    if (complete) captionsByRevision.set(revision, parsedBySlug);
  }
  const completeCandidateRevisions = candidateRevisions.filter(
    (revision) => captionsByRevision.has(revision),
  );
  if (completeCandidateRevisions.length === 0) {
    throw new Error(
      "Blind caption review requires at least one complete valid candidate.",
    );
  }

  const reviewItems = [];
  const keyItems = [];
  for (const [index, pet] of pets
    .toSorted((left, right) => left.slug.localeCompare(right.slug))
    .entries()) {
    if (pet.frameFiles.length !== 4) {
      throw new Error(`Pet ${pet.slug} must provide exactly four frames.`);
    }
    const orderedRevisions = completeCandidateRevisions.toSorted(
      (left, right) =>
        blindKey(pet.slug, left).localeCompare(blindKey(pet.slug, right)),
    );
    const reviewId = `pet-${String(index + 1).padStart(3, "0")}`;
    const candidates = orderedRevisions.map((revision, candidateIndex) => {
      return {
        label: candidateIndex === 0 ? "A" : "B",
        caption: captionsByRevision.get(revision).get(pet.slug),
        unsupportedFact: null,
        bilingualContradiction: null,
        coverage: null,
        searchUtility: null,
      };
    });
    reviewItems.push({
      reviewId,
      frameFiles: [...pet.frameFiles],
      candidates,
    });
    keyItems.push({
      reviewId,
      petSlug: pet.slug,
      candidates: orderedRevisions.map((captionRevision, candidateIndex) => ({
        label: candidateIndex === 0 ? "A" : "B",
        captionRevision,
      })),
    });
  }

  return {
    review: {
      schemaVersion: 1,
      instructions: {
        unsupportedFact:
          "boolean; true for any unsupported identity, backstory, protected attribute, exact age, or other unseen claim",
        bilingualContradiction:
          "boolean; true when English and Russian fields make conflicting claims",
        coverage: "integer 1..5",
        searchUtility: "integer 1..5",
      },
      items: reviewItems,
    },
    key: {
      schemaVersion: 1,
      items: keyItems,
    },
  };
}

export function parseCompletedBlindCaptionReviews(review, key) {
  if (review?.schemaVersion !== 1 || key?.schemaVersion !== 1) {
    throw new Error("Blind review artifact schema is unsupported.");
  }
  if (
    !Array.isArray(review.items) ||
    !Array.isArray(key.items) ||
    review.items.length !== key.items.length
  ) {
    throw new Error("Blind review artifact is incomplete.");
  }
  const keyByReviewId = new Map(
    key.items.map((item) => [item.reviewId, item]),
  );
  if (keyByReviewId.size !== key.items.length) {
    throw new Error("Blind review key contains duplicate review IDs.");
  }

  const completed = [];
  for (const reviewItem of review.items) {
    const keyItem = keyByReviewId.get(reviewItem.reviewId);
    const candidateCount = keyItem?.candidates?.length ?? 0;
    if (
      !keyItem ||
      !Array.isArray(reviewItem.candidates) ||
      !Array.isArray(keyItem.candidates) ||
      candidateCount < 1 ||
      candidateCount > 2 ||
      reviewItem.candidates.length !== candidateCount
    ) {
      throw new Error("Blind review artifact is incomplete.");
    }
    const keyByLabel = new Map(
      keyItem.candidates.map((candidate) => [
        candidate.label,
        candidate.captionRevision,
      ]),
    );
    if (keyByLabel.size !== candidateCount) {
      throw new Error("Blind review key contains duplicate candidate labels.");
    }
    for (const candidate of reviewItem.candidates) {
      const captionRevision = keyByLabel.get(candidate.label);
      if (
        typeof captionRevision !== "string" ||
        typeof candidate.unsupportedFact !== "boolean" ||
        typeof candidate.bilingualContradiction !== "boolean" ||
        !validScore(candidate.coverage) ||
        !validScore(candidate.searchUtility)
      ) {
        throw new Error("Every blind review score must be complete.");
      }
      completed.push({
        petSlug: keyItem.petSlug,
        captionRevision,
        unsupportedFact: candidate.unsupportedFact,
        bilingualContradiction: candidate.bilingualContradiction,
        coverage: candidate.coverage,
        searchUtility: candidate.searchUtility,
      });
    }
  }
  return completed;
}

function validScore(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

function blindKey(slug, revision) {
  return createHash("sha256")
    .update(slug)
    .update("\0")
    .update(revision)
    .digest("hex");
}
