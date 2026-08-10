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
  evaluateRelatedPetsProfile,
} from "@/lib/pets/related-pets-calibration";
import {
  CURRENT_RELATED_PETS_RANKING_PROFILE,
  LEGACY_RELATED_PETS_V7_PROFILE,
  RELATED_PETS_V8_CALIBRATION_PROFILE,
} from "@/lib/pets/related-pets-profile";
import { rankRelatedPetsWithDiagnostics } from "@/lib/pets/related-pets-ranking";
import {
  getCurrentRelatedPetsVisualSourceContext,
  prepareRelatedPetsRankingInputs,
  type RelatedPetsRebuildProfile,
} from "@/lib/pets/related-pets-rebuild";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";

const LIVE_EVAL_MODE = process.env.PET_RELATED_LIVE_EVAL;
const LIVE_EVAL_SPLIT = LIVE_EVAL_MODE === "select" ||
    LIVE_EVAL_MODE === "calibrate"
  ? "calibration"
  : LIVE_EVAL_MODE === "holdout"
    ? "holdout"
    : null;

describe.skipIf(!LIVE_EVAL_SPLIT)("live related-pet evaluation", () => {
  it(
    "selects, pins, and checks the v8 profile without fitting holdout",
    async () => {
      if (!LIVE_EVAL_SPLIT) {
        throw new Error("Related-pet live eval mode is invalid.");
      }
      const selectedBaseProfile = LIVE_EVAL_MODE === "select"
        ? RELATED_PETS_V8_CALIBRATION_PROFILE
        : CURRENT_RELATED_PETS_RANKING_PROFILE;
      if (
        LIVE_EVAL_MODE !== "select" &&
        selectedBaseProfile.strategy !== "theme-first-v8"
      ) {
        throw new Error(
          "Pinned calibration and holdout require v8 to be the current immutable profile.",
        );
      }

      const profile = withVisualCaptionRevision(selectedBaseProfile);
      const legacyProfile = withVisualCaptionRevision(
        LEGACY_RELATED_PETS_V7_PROFILE,
      );
      const visualContext = getCurrentRelatedPetsVisualSourceContext();
      if (!visualContext) {
        throw new Error(
          "Related-pet live eval requires the exact current visual source configuration.",
        );
      }

      const [
        pets,
        textQueryRows,
        legacyTextQueryRows,
        textRows,
        visualRows,
        captions,
      ] = await Promise.all([
        listApprovedPetsForSearch(),
        listRawPetSearchEmbeddings(profile.textQueryRevision),
        listRawPetSearchEmbeddings(legacyProfile.textQueryRevision),
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
      const legacyPrepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows: legacyTextQueryRows,
        textRows,
        visualRows,
        captions,
        profile: legacyProfile,
        visualContext,
      });
      const cases = createRelatedPetsCalibrationCases(fixtures);
      const selectedCases = LIVE_EVAL_SPLIT === "calibration"
        ? cases.calibration
        : cases.holdout;
      const requiredSlugs = new Set(
        selectedCases.flatMap(
          ({ sourceSlug, relevantSlugs, negativeSlugs = [] }) => [
            sourceSlug,
            ...relevantSlugs,
            ...negativeSlugs,
          ],
        ),
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
        missingLegacyTextQuerySlugs: missingSlugs(
          requiredSlugs,
          legacyPrepared.textQueryVectors,
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
        missingLegacyTextQuerySlugs: [],
        missingVisualSlugs: [],
      });

      const observations = createRelatedPetsCalibrationObservations({
        cases: selectedCases,
        candidates: prepared.approvedPets,
        textQueryVectors: prepared.textQueryVectors,
        textDocumentVectors: prepared.textDocumentVectors,
        visualVectors: prepared.visualVectors,
        strategy: "theme-first-v8",
      });
      const legacyObservations = createRelatedPetsCalibrationObservations({
        cases: selectedCases,
        candidates: legacyPrepared.approvedPets,
        textQueryVectors: legacyPrepared.textQueryVectors,
        textDocumentVectors: legacyPrepared.textDocumentVectors,
        visualVectors: legacyPrepared.visualVectors,
        strategy: "legacy-v7",
      });
      const profileIdentity = {
        rankingRevision: profile.rankingRevision,
        textRevision: profile.textRevision,
        textQueryRevision: profile.textQueryRevision,
        visualRevision: profile.visualRevision,
        visualCaptionRevision: profile.visualCaptionRevision,
      };

      if (LIVE_EVAL_SPLIT === "calibration") {
        const calibration = evaluateRelatedPetsCalibration(
          observations,
          profile,
        );
        const legacyReport = evaluateRelatedPetsProfile(
          legacyObservations,
          legacyProfile,
        );
        const draculaCase = calibration.report.cases.find(
          ({ sourceSlug }) => sourceSlug === "dracula",
        );
        const dracula = prepared.approvedPets.find(
          ({ slug }) => slug === "dracula",
        );
        if (!dracula || !draculaCase) {
          throw new Error("Dracula calibration case is required.");
        }
        const draculaRanking = rankRelatedPetsWithDiagnostics({
          source: dracula,
          candidates: prepared.approvedPets,
          textQueryVectors: prepared.textQueryVectors,
          textDocumentVectors: prepared.textDocumentVectors,
          visualVectors: prepared.visualVectors,
          profile: calibration.selectedProfile,
        });
        const draculaFixture = selectedCases.find(
          ({ sourceSlug }) => sourceSlug === "dracula",
        );
        const relevant = new Set(draculaFixture?.relevantSlugs ?? []);
        const negatives = new Set(draculaFixture?.negativeSlugs ?? []);
        const gates = {
          calibrationGates: Object.values(calibration.comparisons).every(
            Boolean,
          ),
          noWorseThanV7At4:
            calibration.report.hybridNdcgAt4 >= legacyReport.hybridNdcgAt4,
          noWorseThanV7At8:
            calibration.report.hybridNdcgAt8 >= legacyReport.hybridNdcgAt8,
          ladyDInTop4: draculaRanking.slugs.slice(0, 4).includes("lady-d-2"),
          fourRelevantInTop8:
            draculaRanking.slugs.filter((slug) => relevant.has(slug)).length >=
            4,
          noDraculaNegativeInTop8:
            draculaRanking.slugs.every((slug) => !negatives.has(slug)),
        };
        console.info("[codex-pets][related-pets-calibration]", {
          ...profileIdentity,
          mode: LIVE_EVAL_MODE,
          caseCount: observations.length,
          calibration,
          legacyReport,
          gates,
          draculaRanking,
        });
        expect(gates).toEqual({
          calibrationGates: true,
          noWorseThanV7At4: true,
          noWorseThanV7At8: true,
          ladyDInTop4: true,
          fourRelevantInTop8: true,
          noDraculaNegativeInTop8: true,
        });
        if (LIVE_EVAL_MODE === "select") {
          expect(calibration.profileMatches).toBe(false);
        } else {
          expect(calibration.passed).toBe(true);
        }
        return;
      }

      const report = evaluateRelatedPetsHoldout(observations, profile);
      const legacyReport = evaluateRelatedPetsProfile(
        legacyObservations,
        legacyProfile,
      );
      const yunaCase = report.cases.find(
        ({ sourceSlug }) => sourceSlug === "yuna",
      );
      const legacyYunaCase = legacyReport.cases.find(
        ({ sourceSlug }) => sourceSlug === "yuna",
      );
      if (!yunaCase || !legacyYunaCase) {
        throw new Error("Yuna holdout case is required.");
      }
      const gates = {
        baselineGates: report.passed,
        noWorseThanV7At4:
          report.hybridNdcgAt4 >= legacyReport.hybridNdcgAt4,
        noWorseThanV7At8:
          report.hybridNdcgAt8 >= legacyReport.hybridNdcgAt8,
        yunaNoWorseThanTextAt4:
          yunaCase.hybridNdcgAt4 >= yunaCase.textMetadataNdcgAt4,
        yunaNoWorseThanTextAt8:
          yunaCase.hybridNdcgAt8 >= yunaCase.textMetadataNdcgAt8,
        yunaNoWorseThanV7At4:
          yunaCase.hybridNdcgAt4 >= legacyYunaCase.hybridNdcgAt4,
        yunaNoWorseThanV7At8:
          yunaCase.hybridNdcgAt8 >= legacyYunaCase.hybridNdcgAt8,
      };
      console.info("[codex-pets][related-pets-holdout]", {
        ...profileIdentity,
        caseCount: observations.length,
        profile: {
          strategy: profile.strategy,
          textMinSimilarity: profile.textMinSimilarity,
          visualMinSimilarity: profile.visualMinSimilarity,
          visualWeight: profile.visualWeight,
        },
        report,
        legacyReport,
        gates,
      });
      expect(gates).toEqual({
        baselineGates: true,
        noWorseThanV7At4: true,
        noWorseThanV7At8: true,
        yunaNoWorseThanTextAt4: true,
        yunaNoWorseThanTextAt8: true,
        yunaNoWorseThanV7At4: true,
        yunaNoWorseThanV7At8: true,
      });
    },
    180_000,
  );
});

function withVisualCaptionRevision<
  Profile extends Omit<
    RelatedPetsRebuildProfile,
    "visualCaptionRevision" | "visualRevision"
  > & {
    visualRevision: keyof typeof PET_VISUAL_MODEL_REVISIONS;
  },
>(profile: Profile): RelatedPetsRebuildProfile & Profile {
  return {
    ...profile,
    visualCaptionRevision:
      PET_VISUAL_MODEL_REVISIONS[profile.visualRevision].captionRevision,
  };
}

function missingSlugs(
  requiredSlugs: ReadonlySet<string>,
  availableSlugs: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): string[] {
  return Array.from(requiredSlugs)
    .filter((slug) => !availableSlugs.has(slug))
    .toSorted();
}
