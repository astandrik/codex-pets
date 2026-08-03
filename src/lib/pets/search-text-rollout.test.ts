import { describe, expect, it } from "vitest";

import {
  collectSequentially,
  evaluateTextSearchRolloutGate,
  resolveTextEvaluationThreshold,
  toTextSearchObservation,
} from "@/lib/pets/search-text-rollout";

describe("text-only search rollout", () => {
  it("ranks a text-only observation without a visual match input", () => {
    const observation = toTextSearchObservation({
      category: "style",
      query: "query omitted from logs",
      relevantSlugs: ["pet-a"],
      pets: [
        { slug: "pet-a", displayName: "Pet A", description: "", tags: [] },
        { slug: "pet-b", displayName: "Pet B", description: "", tags: [] },
      ],
      lexical: [
        {
          pet: { slug: "pet-b", displayName: "Pet B", description: "", tags: [] },
          score: 1,
          exactIdentifier: false,
        },
      ],
      textMatches: [{ slug: "pet-a", score: 0.8 }],
      threshold: 0.28,
      durationMs: 20,
      reviewedBy: "reviewer@example.com",
    });

    expect(observation.hybridSlugs[0]).toBe("pet-a");
    expect(observation.semanticOnlySlugs).toEqual(["pet-a"]);
    expect(observation.reviewedBy).toBe("reviewer@example.com");
  });

  it("requires reviewer identity and three measured HTTP fallbacks for holdout", () => {
    const report = {
      exactNameMrrAt5: 1,
      lexicalNdcgAt5: 0.5,
      hybridNdcgAt5: 0.7,
      hybridNdcgLift: 0.4,
      sexyHasRelevantTop5: true,
      sexyHumanReviewedTop5: true,
      negativeSemanticOnlySafe: true,
      p95DurationMs: 100,
    };

    expect(
      evaluateTextSearchRolloutGate(report, {
        reviewedBy: "reviewer@example.com",
        providerFallbackHttpStatuses: [200, 200, 200],
      }),
    ).toMatchObject({ passed: true });
    expect(
      evaluateTextSearchRolloutGate(report, {
        reviewedBy: "",
        providerFallbackHttpStatuses: [200, 200, 200],
      }),
    ).toMatchObject({ passed: false });
  });

  it("uses the committed threshold without recalibration on holdout", () => {
    const recalibrate = () => {
      throw new Error("holdout must not recalibrate");
    };

    expect(
      resolveTextEvaluationThreshold("holdout", 0.28, recalibrate),
    ).toBe(0.28);
  });

  it("collects provider observations in fixture order without overlap", async () => {
    let active = 0;
    let maximumActive = 0;
    const events: string[] = [];

    const observations = await collectSequentially(
      ["first", "second", "third"],
      async (fixture) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        events.push(`start:${fixture}`);
        await Promise.resolve();
        events.push(`finish:${fixture}`);
        active -= 1;
        return fixture.toUpperCase();
      },
    );

    expect(observations).toEqual(["FIRST", "SECOND", "THIRD"]);
    expect(maximumActive).toBe(1);
    expect(events).toEqual([
      "start:first",
      "finish:first",
      "start:second",
      "finish:second",
      "start:third",
      "finish:third",
    ]);
  });
});
