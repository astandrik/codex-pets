import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluatePetCaptionCandidate,
  selectPetCaptionWinner,
  type SearchQualityReport,
  type VisualSearchProfileReport,
} from "@/lib/pets/search-eval";
import {
  PET_DERIVED_VISION_CAPTION_REVISION,
  PET_VISION_CAPTION_REVISION,
} from "@/lib/pets/search-vision-contract";
import {
  parseCompletedBlindCaptionReviews,
  selectEligibleCaptionRevisions,
} from "../../../scripts/lib/pet-caption-bakeoff.mjs";

const ENABLED = process.env.PET_SEARCH_BAKEOFF_SELECT === "1";
const TEXT_V1_REVISION = "yandex-text-search-2026-07";
const TEXT_V2_REVISION =
  "yandex-text-embeddings-v2-768-2026-07";

describe.skipIf(!ENABLED)("pet caption bakeoff selection", () => {
  it("selects only among fully passing calibration candidates", () => {
    const root = resolve(
      process.cwd(),
      ".scratch/pet-caption-bakeoff",
    );
    const review = readJson(
      resolve(root, "review.json"),
    ) as Parameters<typeof parseCompletedBlindCaptionReviews>[0];
    const key = readJson(
      resolve(root, ".candidate-key.json"),
    ) as Parameters<typeof parseCompletedBlindCaptionReviews>[1];
    const reviews = parseCompletedBlindCaptionReviews(review, key);
    const calibrationDirectory = resolve(root, "calibration");
    const artifacts = readdirSync(calibrationDirectory)
      .filter((filename) => filename.endsWith(".json"))
      .map((filename) =>
        readJson(resolve(calibrationDirectory, filename))
      ) as CalibrationArtifact[];
    const baseline = artifacts.find(
      (artifact) => artifact.textRevision === TEXT_V1_REVISION,
    );
    if (!baseline) {
      throw new Error("A freshly rerun v1 calibration baseline is required.");
    }
    const preflight = readJson(
      resolve(process.cwd(), ".scratch/pet-search-v2-preflight.json"),
    );
    const candidateRevisions = selectEligibleCaptionRevisions(
      preflight,
      PET_VISION_CAPTION_REVISION,
      PET_DERIVED_VISION_CAPTION_REVISION,
    );
    const approvedPetSlugs = baseline.approvedPetSlugs.toSorted();
    const candidates = candidateRevisions.map((captionRevision) => {
      const artifact = artifacts.find(
        (candidate) =>
          candidate.textRevision === TEXT_V2_REVISION &&
          candidate.captionRevision === captionRevision,
      );
      if (!artifact) {
        throw new Error(
          `Calibration artifact is missing for ${captionRevision}.`,
        );
      }
      if (!sameStringSet(artifact.approvedPetSlugs, approvedPetSlugs)) {
        throw new Error(
          `Approved-pet coverage differs for ${captionRevision}.`,
        );
      }
      return evaluatePetCaptionCandidate({
        captionRevision,
        visualRevision: artifact.visualRevision,
        approvedPetSlugs,
        reviews: reviews.filter(
          (reviewItem) =>
            reviewItem.captionRevision === captionRevision,
        ),
        schemaFailureSlugs: artifact.schemaFailureSlugs,
        missingCaptionSlugs: artifact.missingCaptionSlugs,
        textReport: artifact.textReport,
        visualReport: {
          ...artifact.visualReport,
          rankings: [],
        },
        freshV1TextNdcgAt5:
          baseline.textReport.hybridNdcgAt5,
      });
    });
    const winner = selectPetCaptionWinner(
      candidates,
      PET_VISION_CAPTION_REVISION,
    );
    const winnerArtifact = artifacts.find(
      (artifact) => artifact.visualRevision === winner.visualRevision,
    )!;
    mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(
      resolve(root, "winner.json"),
      `${JSON.stringify({
        schemaVersion: 1,
        textRevision: TEXT_V2_REVISION,
        textMinSemanticScore: winnerArtifact.textMinSemanticScore,
        captionRevision: winner.captionRevision,
        visualRevision: winner.visualRevision,
        visualProfile: winnerArtifact.profile,
        meanHumanScore: winner.meanHumanScore,
      }, null, 2)}\n`,
      { mode: 0o600 },
    );

    expect(winner.passed).toBe(true);
  });
});

type CalibrationArtifact = {
  schemaVersion: 1;
  textRevision: string;
  captionRevision: string;
  visualRevision: string;
  textMinSemanticScore: number;
  profile: { minSemanticScore: number; weight: number };
  textReport: SearchQualityReport;
  visualReport: Omit<VisualSearchProfileReport, "rankings">;
  approvedPetSlugs: string[];
  missingCaptionSlugs: string[];
  schemaFailureSlugs: string[];
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedRight = right.toSorted();
  return (
    left.length === new Set(left).size &&
    right.length === new Set(right).size &&
    left.toSorted().every((value, index) => value === sortedRight[index])
  );
}
