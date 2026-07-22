import { describe, expect, it } from "vitest";

import fixtures from "@/lib/pets/search-eval-fixtures.json";
import {
  evaluateSearchRolloutGate,
  evaluateSearchQuality,
  selectSemanticThreshold,
} from "@/lib/pets/search-eval";
import { PET_SEARCH_MODEL_REVISIONS } from "@/lib/pets/search-config";

describe("pet search evaluation", () => {
  it("covers every required query family without claiming unfinished human review", () => {
    expect(new Set(fixtures.map((fixture) => fixture.category))).toEqual(
      new Set(["exact", "multi-token", "typo", "style", "russian", "negative"]),
    );
    expect(fixtures.map((fixture) => fixture.query)).toEqual(
      expect.arrayContaining(["cute", "badass", "sexy"]),
    );
    expect(
      fixtures.find((fixture) => fixture.query === "sexy")?.reviewedBy,
    ).toBeNull();
  });

  it("selects the fixed model threshold from labeled semantic scores", () => {
    const threshold = selectSemanticThreshold([
      {
        relevantSlugs: ["nozomi-2"],
        negative: false,
        matches: [
          { slug: "nozomi-2", score: 0.78 },
          { slug: "unrelated", score: 0.48 },
        ],
      },
      {
        relevantSlugs: ["crawlstack-polished"],
        negative: false,
        matches: [{ slug: "crawlstack-polished", score: 0.66 }],
      },
      {
        relevantSlugs: [],
        negative: true,
        matches: [{ slug: "unrelated", score: 0.54 }],
      },
    ]);

    expect(threshold).toBe(0.55);
    expect(
      PET_SEARCH_MODEL_REVISIONS["yandex-text-search-2026-07"]
      .minSemanticScore,
    ).toBe(threshold);
  });

  it("refuses to calibrate or pass safety without negative fixtures", () => {
    expect(() =>
      selectSemanticThreshold([
        {
          relevantSlugs: ["nozomi-2"],
          negative: false,
          matches: [{ slug: "nozomi-2", score: 0.78 }],
        },
      ]),
    ).toThrow(/negative fixtures/i);

    expect(
      evaluateSearchQuality([
        {
          category: "exact",
          query: "Zero Two",
          relevantSlugs: ["zero-two"],
          lexicalSlugs: ["zero-two"],
          hybridSlugs: ["zero-two"],
          semanticOnlySlugs: [],
          durationMs: 100,
        },
      ]).negativeSemanticOnlySafe,
    ).toBe(false);
  });

  it("computes rollout gates from ranked observations", () => {
    const report = evaluateSearchQuality([
      {
        category: "exact",
        query: "Zero Two",
        relevantSlugs: ["zero-two"],
        lexicalSlugs: ["zero-two"],
        hybridSlugs: ["zero-two"],
        semanticOnlySlugs: [],
        durationMs: 700,
      },
      {
        category: "style",
        query: "sexy",
        relevantSlugs: ["nozomi-2"],
        lexicalSlugs: [],
        hybridSlugs: ["nozomi-2"],
        semanticOnlySlugs: ["nozomi-2"],
        durationMs: 850,
        reviewedBy: "human-reviewer",
      },
      {
        category: "multi-token",
        query: "gothic anime",
        relevantSlugs: ["velvet-luma", "nightshade-2"],
        lexicalSlugs: ["velvet-luma"],
        hybridSlugs: ["velvet-luma", "nightshade-2"],
        semanticOnlySlugs: ["nightshade-2"],
        durationMs: 900,
      },
      {
        category: "negative",
        query: "quantum banana compiler",
        relevantSlugs: [],
        lexicalSlugs: [],
        hybridSlugs: [],
        semanticOnlySlugs: [],
        durationMs: 600,
      },
    ]);

    expect(report.exactNameMrrAt5).toBe(1);
    expect(report.hybridNdcgAt5).toBeGreaterThan(
      report.lexicalNdcgAt5 * 1.2,
    );
    expect(report.sexyHasRelevantTop5).toBe(true);
    expect(report.negativeSemanticOnlySafe).toBe(true);
    expect(report.p95DurationMs).toBeLessThan(1_000);
    expect(
      evaluateSearchRolloutGate(report, [200, 200, 200]),
    ).toMatchObject({ passed: true });
  });
});
