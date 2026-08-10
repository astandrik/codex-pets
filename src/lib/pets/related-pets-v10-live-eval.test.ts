import { describe, expect, it } from "vitest";

import calibrationJson from "@/lib/pets/related-pets-v10-calibration-fixtures.json";
import holdoutJson from "@/lib/pets/related-pets-v9-holdout-fixtures.json";
import {
  createRelatedPetsAcceptanceCases,
  evaluateRelatedPetsAcceptance,
  parseRelatedPetsAcceptanceFixtures,
} from "@/lib/pets/related-pets-acceptance";
import {
  createRelatedPetsCalibrationObservations,
  evaluateRelatedPetsProfile,
} from "@/lib/pets/related-pets-calibration";
import {
  LEGACY_RELATED_PETS_V7_PROFILE,
  RELATED_PETS_V8_PROFILE,
  RELATED_PETS_V10_PROFILE,
} from "@/lib/pets/related-pets-profile";
import {
  getCurrentRelatedPetsVisualSourceContext,
  prepareRelatedPetsRankingInputs,
  type RelatedPetsRebuildProfile,
} from "@/lib/pets/related-pets-rebuild";
import { listPetSearchCaptions } from "@/lib/pets/search-captions-repository";
import { PET_VISUAL_MODEL_REVISIONS } from "@/lib/pets/search-config";
import { listRawPetSearchEmbeddings } from "@/lib/pets/search-embeddings-repository";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import {
  createV10AcceptanceRankings,
  selectRelatedPetsV10Profile,
} from "@/lib/pets/related-pets-v10-eval";

const MODE = process.env.PET_RELATED_V10_EVAL;
const ENABLED = MODE === "calibrate" ||
  MODE === "acceptance" ||
  MODE === "holdout";

describe.skipIf(!ENABLED)("live related-pets V10 evaluation", () => {
  it(
    "calibrates or verifies the frozen explicit V10 gate",
    async () => {
      const holdout = MODE === "holdout";
      const fixtures = parseRelatedPetsAcceptanceFixtures(
        holdout ? holdoutJson : calibrationJson,
      );
      const cases = createRelatedPetsAcceptanceCases(
        fixtures,
        holdout ? "holdout" : "calibration",
      );
      if (
        MODE !== "calibrate" &&
        RELATED_PETS_V10_PROFILE.rankingRevision.endsWith(":candidate")
      ) {
        throw new Error(
          "Pin the immutable V10 profile before acceptance or holdout.",
        );
      }

      const v10Profile = withVisualCaptionRevision(
        RELATED_PETS_V10_PROFILE,
      );
      const v8Profile = withVisualCaptionRevision(RELATED_PETS_V8_PROFILE);
      const v7Profile = withVisualCaptionRevision(
        LEGACY_RELATED_PETS_V7_PROFILE,
      );
      const visualContext = getCurrentRelatedPetsVisualSourceContext();
      if (!visualContext) {
        throw new Error(
          "Related-pet V10 evaluation requires the exact visual source configuration.",
        );
      }
      if (
        !v10Profile.topicQueryRevision ||
        !v10Profile.topicRevision
      ) {
        throw new Error("Related-pet V10 topic profile is incomplete.");
      }

      const [
        pets,
        descriptionQueryRows,
        descriptionRows,
        topicQueryRows,
        topicRows,
        v8QueryRows,
        v7QueryRows,
        searchRows,
        visualRows,
        captions,
      ] = await Promise.all([
        listApprovedPetsForSearch(),
        listRawPetSearchEmbeddings(v10Profile.textQueryRevision),
        listRawPetSearchEmbeddings(v10Profile.textRevision),
        listRawPetSearchEmbeddings(v10Profile.topicQueryRevision),
        listRawPetSearchEmbeddings(v10Profile.topicRevision),
        listRawPetSearchEmbeddings(v8Profile.textQueryRevision),
        listRawPetSearchEmbeddings(v7Profile.textQueryRevision),
        listRawPetSearchEmbeddings(v8Profile.textRevision),
        listRawPetSearchEmbeddings(v10Profile.visualRevision),
        listPetSearchCaptions(v10Profile.visualCaptionRevision),
      ]);
      const v10Prepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows: descriptionQueryRows,
        textRows: descriptionRows,
        topicQueryRows,
        topicRows,
        visualRows,
        captions,
        profile: v10Profile,
        visualContext,
      });
      const v8Prepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows: v8QueryRows,
        textRows: searchRows,
        visualRows,
        captions,
        profile: v8Profile,
        visualContext,
      });
      const v7Prepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows: v7QueryRows,
        textRows: searchRows,
        visualRows,
        captions,
        profile: v7Profile,
        visualContext,
      });
      const coverage = {
        approvedPets: pets.length,
        descriptionQuery: v10Prepared.textQueryVectors.size,
        descriptionDocument: v10Prepared.textDocumentVectors.size,
        topicQuery: v10Prepared.topicQueryVectors.size,
        topicDocument: v10Prepared.topicDocumentVectors.size,
        visual: v10Prepared.visualVectors.size,
      };
      expect(coverage).toEqual({
        approvedPets: pets.length,
        descriptionQuery: pets.length,
        descriptionDocument: pets.length,
        topicQuery: pets.length,
        topicDocument: pets.length,
        visual: pets.length,
      });

      const v10Observations = createRelatedPetsCalibrationObservations({
        cases,
        candidates: v10Prepared.approvedPets,
        textQueryVectors: v10Prepared.textQueryVectors,
        textDocumentVectors: v10Prepared.textDocumentVectors,
        topicQueryVectors: v10Prepared.topicQueryVectors,
        topicDocumentVectors: v10Prepared.topicDocumentVectors,
        visualVectors: v10Prepared.visualVectors,
        strategy: "description-theme-v10",
      });
      const v8Report = evaluateRelatedPetsProfile(
        createRelatedPetsCalibrationObservations({
          cases,
          candidates: v8Prepared.approvedPets,
          textQueryVectors: v8Prepared.textQueryVectors,
          textDocumentVectors: v8Prepared.textDocumentVectors,
          visualVectors: v8Prepared.visualVectors,
          strategy: "theme-first-v8",
        }),
        v8Profile,
      );
      const v7Report = evaluateRelatedPetsProfile(
        createRelatedPetsCalibrationObservations({
          cases,
          candidates: v7Prepared.approvedPets,
          textQueryVectors: v7Prepared.textQueryVectors,
          textDocumentVectors: v7Prepared.textDocumentVectors,
          visualVectors: v7Prepared.visualVectors,
          strategy: "legacy-v7",
        }),
        v7Profile,
      );

      const selected = MODE === "calibrate"
        ? selectRelatedPetsV10Profile({
            fixtures,
            observations: v10Observations,
          })
        : fixedProfileReports({
            observations: v10Observations,
            profile: v10Profile,
          });
      const acceptance = evaluateRelatedPetsAcceptance({
        fixtures,
        minimumCaseCount: holdout ? 3 : 13,
        rankings: createV10AcceptanceRankings({
          fixtures,
          description: selected.descriptionReport,
          noVisual: selected.noVisualReport,
          candidate: selected.report,
          v8: v8Report,
          v7: v7Report,
        }),
      });

      console.info(
        `[codex-pets][related-pets-v10-${MODE}]`,
        JSON.stringify({
          mode: MODE,
          coverage,
          selectedProfile: selected.selectedProfile,
          acceptance,
        }),
      );
      expect(acceptance.passed).toBe(true);
      expect(Object.values(acceptance.checks)).not.toContain(false);
    },
    300_000,
  );
});

function fixedProfileReports(input: {
  observations: ReturnType<typeof createRelatedPetsCalibrationObservations>;
  profile: typeof RELATED_PETS_V10_PROFILE;
}) {
  const selectedProfile = {
    strategy: input.profile.strategy,
    textMinSimilarity: input.profile.textMinSimilarity,
    topicMinSimilarity: input.profile.topicMinSimilarity,
    topicWeight: input.profile.topicWeight,
    metadataWeight: input.profile.metadataWeight,
    visualMinSimilarity: input.profile.visualMinSimilarity,
    visualWeight: input.profile.visualWeight,
  } as const;
  return {
    selectedProfile,
    descriptionReport: evaluateRelatedPetsProfile(input.observations, {
      strategy: "text-first-v9",
      textMinSimilarity: selectedProfile.textMinSimilarity,
      metadataWeight: 0,
      visualMinSimilarity: null,
      visualWeight: 0,
    }),
    noVisualReport: evaluateRelatedPetsProfile(input.observations, {
      ...selectedProfile,
      visualMinSimilarity: null,
      visualWeight: 0,
    }),
    report: evaluateRelatedPetsProfile(input.observations, selectedProfile),
  };
}

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
