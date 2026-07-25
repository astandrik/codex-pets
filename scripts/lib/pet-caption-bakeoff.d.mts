import type {
  VisionBackfillCaption,
} from "./pet-vision-search-backfill.mjs";

export function selectEligibleCaptionRevisions(
  preflight: unknown,
  qwenRevision: string,
  deepSeekRevision: string,
): string[];

export function createBlindCaptionReviewArtifact(input: {
  candidateRevisions: readonly string[];
  pets: Array<{
    slug: string;
    frameFiles: string[];
    captions: Record<string, VisionBackfillCaption>;
  }>;
}): {
  review: {
    schemaVersion: 1;
    instructions: {
      unsupportedFact: string;
      bilingualContradiction: string;
      coverage: string;
      searchUtility: string;
    };
    items: Array<{
      reviewId: string;
      frameFiles: string[];
      candidates: Array<{
        label: "A" | "B";
        caption: VisionBackfillCaption;
        unsupportedFact: boolean | null;
        bilingualContradiction: boolean | null;
        coverage: number | null;
        searchUtility: number | null;
      }>;
    }>;
  };
  key: {
    schemaVersion: 1;
    items: Array<{
      reviewId: string;
      petSlug: string;
      candidates: Array<{
        label: "A" | "B";
        captionRevision: string;
      }>;
    }>;
  };
};

export function parseCompletedBlindCaptionReviews(
  review: ReturnType<typeof createBlindCaptionReviewArtifact>["review"],
  key: ReturnType<typeof createBlindCaptionReviewArtifact>["key"],
): Array<{
  petSlug: string;
  captionRevision: string;
  unsupportedFact: boolean;
  bilingualContradiction: boolean;
  coverage: number;
  searchUtility: number;
}>;
