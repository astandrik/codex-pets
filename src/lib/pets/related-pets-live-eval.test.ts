import { describe, expect, it } from "vitest";

import fixtures from "@/lib/pets/related-pets-eval-fixtures.json";
import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import { PET_VISUAL_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { listRawPetSearchEmbeddings } from "@/lib/pets/search-embeddings-repository";
import {
  createRelatedPetsCalibrationCases,
  createRelatedPetsCalibrationObservations,
  evaluateRelatedPetsCalibration,
  evaluateRelatedPetsHoldout,
} from "@/lib/pets/related-pets-calibration";
import { RELATED_PETS_V24_PROFILE } from "@/lib/pets/related-pets-v24-profile";
import { rankRelatedPetsV24WithDiagnostics } from "@/lib/pets/related-pets-v24-ranking";
import {
  getCurrentRelatedPetsVisualSourceContext,
  prepareRelatedPetsRankingInputs,
  type RelatedPetsRebuildProfile,
} from "@/lib/pets/related-pets-rebuild";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";

const LIVE_EVAL_MODE = process.env.PET_RELATED_LIVE_EVAL;
const LIVE_EVAL_SPLIT =
  LIVE_EVAL_MODE === "calibrate"
    ? "calibration"
    : LIVE_EVAL_MODE === "holdout"
      ? "holdout"
      : null;

describe.skipIf(!LIVE_EVAL_SPLIT)("live related-pet evaluation", () => {
  it(
    "pins calibration output and passes the untouched holdout gate",
    async () => {
      if (!LIVE_EVAL_SPLIT) {
        throw new Error("Related-pet live eval mode is invalid.");
      }
      const profile: RelatedPetsRebuildProfile = {
        ...RELATED_PETS_V24_PROFILE,
        visualCaptionRevision:
          PET_VISUAL_MODEL_REVISIONS[
            RELATED_PETS_V24_PROFILE.visualRevision
          ].captionRevision,
      };
      const visualContext = getCurrentRelatedPetsVisualSourceContext();
      if (!visualContext) {
        throw new Error(
          "Related-pet live eval requires the exact current visual source configuration.",
        );
      }

      const [pets, textQueryRows, textRows, visualRows, captions] =
        await Promise.all([
        listApprovedPetsForSearch(),
        listRawPetSearchEmbeddings(profile.textQueryRevision),
        listRawPetSearchEmbeddings(profile.textRevision),
        listRawPetSearchEmbeddings(profile.visualRevision),
        listPetSearchCaptions(profile.visualCaptionRevision),
        ]);
      const prepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows,
        textRows,
        visualRows,
        captions,
        profile,
        visualContext,
      });
      const cases = createRelatedPetsCalibrationCases(fixtures);
      const selectedCases =
        LIVE_EVAL_SPLIT === "calibration"
          ? cases.calibration
          : cases.holdout;
      const requiredSlugs = new Set(
        selectedCases.flatMap(({ sourceSlug, relevantSlugs }) => [
          sourceSlug,
          ...relevantSlugs,
        ]),
      );
      const approvedSlugs = new Set(
        prepared.approvedPets.map(({ slug }) => slug),
      );
      const coverage = {
        missingApprovedSlugs: missingSlugs(requiredSlugs, approvedSlugs),
        missingTextSlugs: missingSlugs(
          requiredSlugs,
          prepared.textDocumentVectors,
        ),
        missingTextQuerySlugs: missingSlugs(
          requiredSlugs,
          prepared.textQueryVectors,
        ),
        missingVisualSlugs: missingSlugs(
          requiredSlugs,
          prepared.visualVectors,
        ),
      };
      expect(coverage).toEqual({
        missingApprovedSlugs: [],
        missingTextSlugs: [],
        missingTextQuerySlugs: [],
        missingVisualSlugs: [],
      });

      const observations = createRelatedPetsCalibrationObservations({
        cases: selectedCases,
        candidates: prepared.approvedPets,
        textQueryVectors: prepared.textQueryVectors,
        textDocumentVectors: prepared.textDocumentVectors,
        visualVectors: prepared.visualVectors,
      });
      const profileIdentity = {
        rankingRevision: profile.rankingRevision,
        textRevision: profile.textRevision,
        textQueryRevision: profile.textQueryRevision,
        visualRevision: profile.visualRevision,
        visualCaptionRevision: profile.visualCaptionRevision,
      };
      const tallulah = prepared.approvedPets.find(
        ({ slug }) => slug === "tallulah",
      );
      if (!tallulah) {
        throw new Error("Tallulah live regression source is required.");
      }
      const tallulahRanking = rankRelatedPetsV24WithDiagnostics({
        source: tallulah,
        candidates: prepared.approvedPets,
        textQueryVectors: prepared.textQueryVectors,
        textDocumentVectors: prepared.textDocumentVectors,
        annotationQueryVectors: prepared.annotationQueryVectors,
        annotationDocumentVectors: prepared.annotationDocumentVectors,
        annotations: prepared.annotations,
        visualVectors: prepared.visualVectors,
        profile,
      });
      expect(tallulahRanking.slugs).toHaveLength(8);
      expect(new Set(tallulahRanking.slugs).size).toBe(8);
      expect(tallulahRanking.slugs).not.toContain("t-rex");
      expect(tallulahRanking.diagnostics[7]?.tier).toBe(
        "semantic_backfill",
      );

      if (LIVE_EVAL_SPLIT === "calibration") {
        const report = evaluateRelatedPetsCalibration(
          observations,
          profile,
        );
        console.info("[codex-pets][related-pets-calibration]", {
          ...profileIdentity,
          caseCount: observations.length,
          report,
          tallulahRanking,
        });
        const sansCase = report.report.cases.find(
          ({ sourceSlug }) => sourceSlug === "sans",
        );
        const sansObservation = observations.find(
          ({ sourceSlug }) => sourceSlug === "sans",
        );
        const fireSkullTextMatch = sansObservation?.textMatches.find(
          ({ slug }) => slug === "fire-skull",
        );
        expect(sansCase, "Sans calibration case is required").toBeDefined();
        expect(sansCase?.metadataSlugs.slice(0, 4)).not.toContain(
          "fire-skull",
        );
        expect(fireSkullTextMatch?.score).toBeGreaterThanOrEqual(
          profile.textMinSimilarity,
        );
        expect(sansCase?.textMetadataSlugs.slice(0, 4)).toContain(
          "fire-skull",
        );
        expect(sansCase?.hybridSlugs.slice(0, 4)).toContain("fire-skull");
        expect(sansCase?.textMetadataSlugs.slice(0, 4)).not.toEqual(
          sansCase?.metadataSlugs.slice(0, 4),
        );
        expect(report.report.hybridNdcgAt4).toBeCloseTo(0.208333, 6);
        expect(report.report.hybridNdcgAt8).toBeCloseTo(0.224452, 6);
        expect(report.passed).toBe(true);
        return;
      }

      const report = evaluateRelatedPetsHoldout(observations, profile);
      console.info("[codex-pets][related-pets-holdout]", {
        ...profileIdentity,
        caseCount: observations.length,
        profile: {
          textMinSimilarity: profile.textMinSimilarity,
          visualMinSimilarity: profile.visualMinSimilarity,
          visualWeight: profile.visualWeight,
        },
        report,
        tallulahRanking,
      });
      expect(report.hybridNdcgAt4).toBeCloseTo(0.07402, 6);
      expect(report.hybridNdcgAt8).toBeCloseTo(0.111031, 6);
      expect(report.passed).toBe(true);
    },
    180_000,
  );
});

function missingSlugs(
  requiredSlugs: ReadonlySet<string>,
  availableSlugs: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): string[] {
  return Array.from(requiredSlugs)
    .filter((slug) => !availableSlugs.has(slug))
    .toSorted();
}
