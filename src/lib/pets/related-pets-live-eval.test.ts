import { describe, expect, it } from "vitest";

import fixtures from "@/lib/pets/related-pets-eval-fixtures.json";
import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import { PET_VISUAL_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { listRawPetSearchEmbeddings } from "@/lib/pets/search-embeddings-repository";
import {
  createRelatedPetsCalibrationCases,
  createRelatedPetsCalibrationObservations,
  evaluateRelatedPetsCalibration,
  evaluateRelatedPetsProfile,
} from "@/lib/pets/related-pets-calibration";
import {
  LEGACY_RELATED_PETS_V7_PROFILE,
  RELATED_PETS_V8_PROFILE,
  RELATED_PETS_V9_CALIBRATION_PROFILE,
  RELATED_PETS_V9_PROFILE,
} from "@/lib/pets/related-pets-profile";
import { rankRelatedPetsWithDiagnostics } from "@/lib/pets/related-pets-ranking";
import {
  getCurrentRelatedPetsVisualSourceContext,
  prepareRelatedPetsRankingInputs,
  type RelatedPetsRebuildProfile,
} from "@/lib/pets/related-pets-rebuild";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";

const LIVE_EVAL_MODE = process.env.PET_RELATED_LIVE_EVAL;
const LIVE_EVAL_SPLIT =
  LIVE_EVAL_MODE === "select" || LIVE_EVAL_MODE === "calibrate"
  ? "calibration"
  : null;

describe.skipIf(!LIVE_EVAL_SPLIT)("live related-pet evaluation", () => {
  it(
    "selects and checks the v9 profile on calibration fixtures only",
    async () => {
      if (!LIVE_EVAL_SPLIT) {
        throw new Error("Related-pet live eval mode is invalid.");
      }
      const selectedBaseProfile = LIVE_EVAL_MODE === "select"
        ? RELATED_PETS_V9_CALIBRATION_PROFILE
        : RELATED_PETS_V9_PROFILE;
      if (
        LIVE_EVAL_MODE !== "select" &&
        selectedBaseProfile.rankingRevision.endsWith(":candidate")
      ) {
        throw new Error(
          "Pin the immutable v9 profile in a separate commit before running calibration verification.",
        );
      }

      const profile = withVisualCaptionRevision(selectedBaseProfile);
      const legacyProfile = withVisualCaptionRevision(
        LEGACY_RELATED_PETS_V7_PROFILE,
      );
      const v8Profile = withVisualCaptionRevision(RELATED_PETS_V8_PROFILE);
      const visualContext = getCurrentRelatedPetsVisualSourceContext();
      if (!visualContext) {
        throw new Error(
          "Related-pet live eval requires the exact current visual source configuration.",
        );
      }

      const [
        pets,
        textQueryRows,
        v8TextQueryRows,
        legacyTextQueryRows,
        textRows,
        baselineTextRows,
        visualRows,
        captions,
      ] = await Promise.all([
        listApprovedPetsForSearch(),
        listRawPetSearchEmbeddings(profile.textQueryRevision),
        listRawPetSearchEmbeddings(v8Profile.textQueryRevision),
        listRawPetSearchEmbeddings(legacyProfile.textQueryRevision),
        listRawPetSearchEmbeddings(profile.textRevision),
        listRawPetSearchEmbeddings(v8Profile.textRevision),
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
        textRows: baselineTextRows,
        visualRows,
        captions,
        profile: legacyProfile,
        visualContext,
      });
      const v8Prepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows: v8TextQueryRows,
        textRows: baselineTextRows,
        visualRows,
        captions,
        profile: v8Profile,
        visualContext,
      });
      const cases = createRelatedPetsCalibrationCases(fixtures);
      const selectedCases = cases.calibration;
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
        missingV8TextQuerySlugs: missingSlugs(
          requiredSlugs,
          v8Prepared.textQueryVectors,
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
        missingV8TextQuerySlugs: [],
        missingVisualSlugs: [],
      });

      const observations = createRelatedPetsCalibrationObservations({
        cases: selectedCases,
        candidates: prepared.approvedPets,
        textQueryVectors: prepared.textQueryVectors,
        textDocumentVectors: prepared.textDocumentVectors,
        visualVectors: prepared.visualVectors,
        strategy: "text-first-v9",
      });
      const legacyObservations = createRelatedPetsCalibrationObservations({
        cases: selectedCases,
        candidates: legacyPrepared.approvedPets,
        textQueryVectors: legacyPrepared.textQueryVectors,
        textDocumentVectors: legacyPrepared.textDocumentVectors,
        visualVectors: legacyPrepared.visualVectors,
        strategy: "legacy-v7",
      });
      const v8Observations = createRelatedPetsCalibrationObservations({
        cases: selectedCases,
        candidates: v8Prepared.approvedPets,
        textQueryVectors: v8Prepared.textQueryVectors,
        textDocumentVectors: v8Prepared.textDocumentVectors,
        visualVectors: v8Prepared.visualVectors,
        strategy: "theme-first-v8",
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
        const v8Report = evaluateRelatedPetsProfile(
          v8Observations,
          v8Profile,
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
          noWorseThanV8At4:
            calibration.report.hybridNdcgAt4 >= v8Report.hybridNdcgAt4,
          noWorseThanV8At8:
            calibration.report.hybridNdcgAt8 >= v8Report.hybridNdcgAt8,
          ladyDInTop4: draculaRanking.slugs.slice(0, 4).includes("lady-d-2"),
          fourRelevantInTop8:
            draculaRanking.slugs.filter((slug) => relevant.has(slug)).length >=
            4,
          noDraculaNegativeInTop8:
            draculaRanking.slugs.every((slug) => !negatives.has(slug)),
        };
        console.info(
          "[codex-pets][related-pets-calibration]",
          JSON.stringify({
            ...profileIdentity,
            mode: LIVE_EVAL_MODE,
            caseCount: observations.length,
            calibration,
            v8Report,
            legacyReport,
            gates,
            draculaRanking,
          }),
        );
        expect(gates).toEqual({
          calibrationGates: true,
          noWorseThanV7At4: true,
          noWorseThanV7At8: true,
          noWorseThanV8At4: true,
          noWorseThanV8At8: true,
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
