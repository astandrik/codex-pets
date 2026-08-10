import { describe, expect, it } from "vitest";

import fixturesJson from "@/lib/pets/related-pets-acceptance-fixtures.json";
import holdoutFixturesJson from "@/lib/pets/related-pets-v9-holdout-fixtures.json";
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
  RELATED_PETS_V9_PROFILE,
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

const EVALUATION_MODE = process.env.PET_RELATED_ACCEPTANCE_EVAL;
const ACCEPTANCE_ENABLED =
  EVALUATION_MODE === "acceptance" || EVALUATION_MODE === "holdout";

describe.skipIf(!ACCEPTANCE_ENABLED)("live related-pets acceptance", () => {
  it(
    "checks a frozen v9 product gate without fitting parameters",
    async () => {
      const fixtureInput = EVALUATION_MODE === "holdout"
        ? holdoutFixturesJson
        : fixturesJson;
      const fixtures = parseRelatedPetsAcceptanceFixtures(fixtureInput);
      const cases = createRelatedPetsAcceptanceCases(fixtures);
      if (RELATED_PETS_V9_PROFILE.rankingRevision.endsWith(":candidate")) {
        throw new Error(
          "Pin the immutable v9 profile before running acceptance.",
        );
      }
      const v9Profile = withVisualCaptionRevision(RELATED_PETS_V9_PROFILE);
      const v8Profile = withVisualCaptionRevision(RELATED_PETS_V8_PROFILE);
      const v7Profile = withVisualCaptionRevision(
        LEGACY_RELATED_PETS_V7_PROFILE,
      );
      const visualContext = getCurrentRelatedPetsVisualSourceContext();
      if (!visualContext) {
        throw new Error(
          "Related-pet acceptance requires the exact visual source configuration.",
        );
      }

      const [
        pets,
        v9TextQueryRows,
        v8TextQueryRows,
        v7TextQueryRows,
        v9TextRows,
        textRows,
        visualRows,
        captions,
      ] = await Promise.all([
        listApprovedPetsForSearch(),
        listRawPetSearchEmbeddings(v9Profile.textQueryRevision),
        listRawPetSearchEmbeddings(v8Profile.textQueryRevision),
        listRawPetSearchEmbeddings(v7Profile.textQueryRevision),
        listRawPetSearchEmbeddings(v9Profile.textRevision),
        listRawPetSearchEmbeddings(v8Profile.textRevision),
        listRawPetSearchEmbeddings(v8Profile.visualRevision),
        listPetSearchCaptions(v8Profile.visualCaptionRevision),
      ]);
      const v9Prepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows: v9TextQueryRows,
        textRows: v9TextRows,
        visualRows,
        captions,
        profile: v9Profile,
        visualContext,
      });
      const v8Prepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows: v8TextQueryRows,
        textRows,
        visualRows,
        captions,
        profile: v8Profile,
        visualContext,
      });
      const v7Prepared = prepareRelatedPetsRankingInputs({
        pets,
        textQueryRows: v7TextQueryRows,
        textRows,
        visualRows,
        captions,
        profile: v7Profile,
        visualContext,
      });
      const requiredSlugs = new Set(
        fixtures.flatMap((fixture) => [
          fixture.sourceSlug,
          ...Object.keys(fixture.relevance),
          ...fixture.negativeSlugs,
        ]),
      );
      const coverage = {
        approvedPets: v9Prepared.approvedPets.length,
        missingApprovedSlugs: missingSlugs(
          requiredSlugs,
          new Set(v9Prepared.approvedPets.map(({ slug }) => slug)),
        ),
        missingV9TextQuerySlugs: missingSlugs(
          requiredSlugs,
          v9Prepared.textQueryVectors,
        ),
        missingV9TextDocumentSlugs: missingSlugs(
          requiredSlugs,
          v9Prepared.textDocumentVectors,
        ),
        missingV8TextQuerySlugs: missingSlugs(
          requiredSlugs,
          v8Prepared.textQueryVectors,
        ),
        missingV7TextQuerySlugs: missingSlugs(
          requiredSlugs,
          v7Prepared.textQueryVectors,
        ),
        missingTextDocumentSlugs: missingSlugs(
          requiredSlugs,
          v8Prepared.textDocumentVectors,
        ),
        missingVisualSlugs: missingSlugs(
          requiredSlugs,
          v8Prepared.visualVectors,
        ),
      };
      expect(coverage).toEqual({
        approvedPets: pets.length,
        missingApprovedSlugs: [],
        missingV9TextQuerySlugs: [],
        missingV9TextDocumentSlugs: [],
        missingV8TextQuerySlugs: [],
        missingV7TextQuerySlugs: [],
        missingTextDocumentSlugs: [],
        missingVisualSlugs: [],
      });

      const v9Report = evaluateRelatedPetsProfile(
        createRelatedPetsCalibrationObservations({
          cases,
          candidates: v9Prepared.approvedPets,
          textQueryVectors: v9Prepared.textQueryVectors,
          textDocumentVectors: v9Prepared.textDocumentVectors,
          visualVectors: v9Prepared.visualVectors,
          strategy: "text-first-v9",
        }),
        v9Profile,
      );

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
      const v7CasesBySource = new Map(
        v7Report.cases.map((item) => [item.sourceSlug, item]),
      );
      const v8CasesBySource = new Map(
        v8Report.cases.map((item) => [item.sourceSlug, item]),
      );
      const report = evaluateRelatedPetsAcceptance({
        fixtures,
        minimumCaseCount: EVALUATION_MODE === "holdout" ? 3 : undefined,
        rankings: v9Report.cases.map((item) => {
          const v8Case = v8CasesBySource.get(item.sourceSlug);
          const v7Case = v7CasesBySource.get(item.sourceSlug);
          if (!v8Case || !v7Case) {
            throw new Error(
              `Baseline acceptance ranking is missing for ${item.sourceSlug}.`,
            );
          }
          return {
            sourceSlug: item.sourceSlug,
            metadataSlugs: item.metadataSlugs,
            textSlugs: item.textOnlySlugs,
            noVisualSlugs: item.textMetadataSlugs,
            candidateSlugs: item.hybridSlugs,
            v8Slugs: v8Case.hybridSlugs,
            v7Slugs: v7Case.hybridSlugs,
          };
        }),
      });

      console.info(
        `[codex-pets][related-pets-${EVALUATION_MODE}]`,
        JSON.stringify({
          profile: {
            rankingRevision: v9Profile.rankingRevision,
            textMinSimilarity: v9Profile.textMinSimilarity,
            visualMinSimilarity: v9Profile.visualMinSimilarity,
            visualWeight: v9Profile.visualWeight,
          },
          mode: EVALUATION_MODE,
          coverage,
          report,
        }),
      );
      expect(report.passed).toBe(true);
      expect(Object.values(report.checks)).not.toContain(false);
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
