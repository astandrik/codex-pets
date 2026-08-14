import { describe, expect, it, vi } from "vitest";

import {
  RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS,
  evaluateRelatedPetsV24Acceptance,
  type RelatedPetsV24AcceptanceReport,
} from "@/lib/pets/related-pets-v24-acceptance";
import { createRelatedPetsV24JudgeClient } from
  "@/lib/pets/related-pets-v24-judge-client";
import {
  RELATED_PETS_V24_JUDGE_RESPONSE_JSON_SCHEMA,
  parseRelatedPetsV24JudgeResult,
} from "@/lib/pets/related-pets-v24-judge-contract.mjs";

describe("related pets V24 acceptance", () => {
  it("uses exactly two blinded gpt-oss requests with medium reasoning", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const outputs = [judgment("B", 1, 2, "high"), judgment("A", 2, 1, "medium")];
    const client = createRelatedPetsV24JudgeClient({
      folderId: "folder-1",
      apiKey: "SECRET_KEY",
      modelUri: "gpt://folder-1/gpt-oss-120b",
      timeoutMs: 30_000,
      fetchImpl: vi.fn(async (_url, init) => {
        bodies.push(JSON.parse(String(init?.body)));
        return completedResponse(outputs.shift());
      }),
    });

    await expect(client.judgeBlindedPair(input())).resolves.toMatchObject({
      requests: 2,
      orderConsistent: true,
      decision: { preference: "B", top4: "B", top8: "B" },
      confidence: "medium",
      needsManualReview: false,
      baselineGrades: Array(8).fill(1),
      candidateGrades: Array(8).fill(2),
    });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toMatchObject({
      model: "gpt://folder-1/gpt-oss-120b",
      store: false,
      temperature: 0,
      reasoning: { effort: "medium" },
    });
    const userContent = JSON.stringify(bodies[0]?.input);
    expect(userContent).not.toMatch(/slug|annotation|similarity|v23|v24/i);
    expect(JSON.stringify(bodies[0])).not.toContain("SECRET_KEY");
  });

  it("marks swapped disagreement and low confidence for manual review", async () => {
    const outputs = [judgment("B", 1, 2, "high"), judgment("B", 1, 2, "low")];
    const result = await createRelatedPetsV24JudgeClient({
      folderId: "folder-1",
      apiKey: "key",
      modelUri: "gpt://folder-1/gpt-oss-120b",
      timeoutMs: 30_000,
      fetchImpl: async () => completedResponse(outputs.shift()),
    }).judgeBlindedPair(input());

    expect(result).toMatchObject({
      requests: 2,
      orderConsistent: false,
      decision: { preference: null, top4: null, top8: null },
      confidence: "low",
      needsManualReview: true,
    });
  });

  it("passes a modest aggregate lift with more wins than losses and clear Tigran lift", () => {
    const reports = acceptanceReports().map((report, index) => {
      if (report.sourceSlug === "tigran" || index === 0) {
        return { ...report, ...decision("B", 1, 2) };
      }
      return report;
    });
    expect(evaluateRelatedPetsV24Acceptance({ reports })).toMatchObject({
      status: "passed",
      passed: true,
      sourceCount: 15,
      candidateWins: 2,
      baselineWins: 0,
      severeRegressionSources: [],
      tigranClearlyBetter: true,
    });
  });

  it("requires manual resolution only for order-sensitive or low-confidence sources", () => {
    const reports = acceptanceReports().map((report) =>
      report.sourceSlug === "tigran"
        ? {
            ...report,
            ...decision("B", 1, 2),
            orderConsistent: false,
            confidence: "low" as const,
            decision: { preference: null, top4: null, top8: null },
          }
        : report);
    expect(evaluateRelatedPetsV24Acceptance({ reports })).toMatchObject({
      status: "needs-review",
      failures: expect.arrayContaining(["manual_review_unresolved"]),
      unresolvedSources: ["tigran"],
    });
    expect(evaluateRelatedPetsV24Acceptance({
      reports,
      manualDecisions: [{
        sourceSlug: "tigran",
        preference: "B",
        top4: "B",
        top8: "B",
        noteCode: "visual_supports_candidate",
      }],
    })).toMatchObject({ status: "passed", tigranClearlyBetter: true });
  });

  it("rejects a source losing more than half a grade in top four", () => {
    const reports = acceptanceReports().map((report) => {
      if (report.sourceSlug === "tigran") return { ...report, ...decision("B", 1, 2) };
      if (report.sourceSlug === "kesha") return { ...report, ...decision("A", 2, 1) };
      return report;
    });
    expect(evaluateRelatedPetsV24Acceptance({ reports })).toMatchObject({
      status: "failed",
      failures: expect.arrayContaining(["severe_source_regression"]),
      severeRegressionSources: ["kesha"],
    });
  });

  it("does not allow manual decisions to override confident judge results", () => {
    expect(() => evaluateRelatedPetsV24Acceptance({
      reports: acceptanceReports(),
      manualDecisions: [{
        sourceSlug: "tigran",
        preference: "B",
        top4: "B",
        top8: "B",
        noteCode: "visual_supports_candidate",
      }],
    })).toThrow("flagged sources only");
  });

  it("rejects malformed output and duplicate grade positions", () => {
    expect(RELATED_PETS_V24_JUDGE_RESPONSE_JSON_SCHEMA).not.toHaveProperty(
      "properties.slateAGrades.uniqueItems",
    );
    expect(() => parseRelatedPetsV24JudgeResult({
      ...judgment("B", 1, 2, "high"),
      slateAGrades: grades(1).map((row) => ({ ...row, position: 1 })),
    })).toThrow("unique and complete");
  });
});

function input() {
  return {
    source: card("Source"),
    slateA: Array.from({ length: 8 }, (_, index) => card(`Baseline ${index}`)),
    slateB: Array.from({ length: 8 }, (_, index) => card(`Candidate ${index}`)),
  };
}

function card(displayName: string) {
  return {
    displayName,
    kind: "character" as const,
    description: `${displayName} description`,
  };
}

function judgment(
  preference: "A" | "B" | "tie",
  gradeA: number,
  gradeB: number,
  confidence: "low" | "medium" | "high",
) {
  return {
    slateAGrades: grades(gradeA),
    slateBGrades: grades(gradeB),
    preference,
    top4: preference,
    top8: preference,
    confidence,
  };
}

function grades(grade: number) {
  return Array.from({ length: 8 }, (_, index) => ({ position: index + 1, grade }));
}

function completedResponse(value: unknown) {
  return Response.json({
    status: "completed",
    output: [{ type: "message", content: [{
      type: "output_text",
      text: JSON.stringify(value),
    }] }],
  });
}

function acceptanceReports(): RelatedPetsV24AcceptanceReport[] {
  return RELATED_PETS_V24_ACCEPTANCE_SOURCE_SLUGS.map((sourceSlug) => ({
    sourceSlug,
    baselineTop8: ranking(sourceSlug, "baseline"),
    candidateTop8: ranking(sourceSlug, "candidate"),
    parsed: true,
    requests: 2,
    orderConsistent: true,
    confidence: "high",
    decision: { preference: "tie", top4: "tie", top8: "tie" },
    baselineGrades: Array(8).fill(1),
    candidateGrades: Array(8).fill(1),
  }));
}

function decision(
  preference: "A" | "B" | "tie",
  baselineGrade: number,
  candidateGrade: number,
) {
  return {
    decision: { preference, top4: preference, top8: preference },
    baselineGrades: Array(8).fill(baselineGrade),
    candidateGrades: Array(8).fill(candidateGrade),
  };
}

function ranking(sourceSlug: string, prefix: string) {
  return Array.from({ length: 8 }, (_, index) => `${prefix}-${sourceSlug}-${index}`);
}
