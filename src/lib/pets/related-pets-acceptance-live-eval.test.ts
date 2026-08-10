import { describe, expect, it } from "vitest";

import fixturesJson from "@/lib/pets/related-pets-acceptance-fixtures.json";
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

const ACCEPTANCE_ENABLED = process.env.PET_RELATED_ACCEPTANCE_EVAL === "1";

describe.skipIf(!ACCEPTANCE_ENABLED)("live related-pets acceptance", () => {
  it(
    "checks the frozen graded product gate without fitting parameters",
    async () => {
      const fixtures = parseRelatedPetsAcceptanceFixtures(fixturesJson);
      const cases = createRelatedPetsAcceptanceCases(fixtures);
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
        v8TextQueryRows,
        v7TextQueryRows,
        textRows,
        visualRows,
        captions,
      ] = await Promise.all([
        listApprovedPetsForSearch(),
        listRawPetSearchEmbeddings(v8Profile.textQueryRevision),
        listRawPetSearchEmbeddings(v7Profile.textQueryRevision),
        listRawPetSearchEmbeddings(v8Profile.textRevision),
        listRawPetSearchEmbeddings(v8Profile.visualRevision),
        listPetSearchCaptions(v8Profile.visualCaptionRevision),
      ]);
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
        approvedPets: v8Prepared.approvedPets.length,
        missingApprovedSlugs: missingSlugs(
          requiredSlugs,
          new Set(v8Prepared.approvedPets.map(({ slug }) => slug)),
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
        missingV8TextQuerySlugs: [],
        missingV7TextQuerySlugs: [],
        missingTextDocumentSlugs: [],
        missingVisualSlugs: [],
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
      const v7CasesBySource = new Map(
        v7Report.cases.map((item) => [item.sourceSlug, item]),
      );
      const report = evaluateRelatedPetsAcceptance({
        fixtures,
        rankings: v8Report.cases.map((item) => {
          const v7Case = v7CasesBySource.get(item.sourceSlug);
          if (!v7Case) {
            throw new Error(
              `V7 acceptance ranking is missing for ${item.sourceSlug}.`,
            );
          }
          return {
            sourceSlug: item.sourceSlug,
            metadataSlugs: item.metadataSlugs,
            textSlugs: item.textMetadataSlugs,
            v8Slugs: item.hybridSlugs,
            v7Slugs: v7Case.hybridSlugs,
          };
        }),
      });

      console.info("[codex-pets][related-pets-acceptance]", {
        profile: {
          rankingRevision: v8Profile.rankingRevision,
          textMinSimilarity: v8Profile.textMinSimilarity,
          visualMinSimilarity: v8Profile.visualMinSimilarity,
          visualWeight: v8Profile.visualWeight,
        },
        coverage,
        passed: report.passed,
        checks: report.checks,
        aggregate: report.aggregate,
        improvedCaseCount: report.improvedCaseCount,
        cases: report.cases.map((item) => ({
          id: item.id,
          sourceSlug: item.sourceSlug,
          metrics: item.metrics,
          v8Slugs: item.v8Slugs,
          textSlugs: item.textSlugs,
          v7Slugs: item.v7Slugs,
          textNdcgAt8Delta: item.textNdcgAt8Delta,
          mustIncludeTop4Satisfied: item.mustIncludeTop4Satisfied,
          negativeTop8Slugs: item.negativeTop8Slugs,
        })),
      });
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
