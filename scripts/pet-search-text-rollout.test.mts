import { describe, expect, it } from "vitest";

import {
  parseTextRolloutEvidence,
} from "./lib/pet-search-text-rollout.mjs";

describe("text-only rollout evidence", () => {
  it("requires three measured fallback statuses for the holdout gate", () => {
    expect(
      parseTextRolloutEvidence({
        PET_SEARCH_TEXT_FALLBACK_HTTP_STATUSES: "200, 200, 200",
        PET_SEARCH_TEXT_HOLDOUT_REVIEWED_BY: "reviewer@example.com",
      }),
    ).toEqual({
      providerFallbackHttpStatuses: [200, 200, 200],
      reviewedBy: "reviewer@example.com",
    });
  });

  it("rejects incomplete fallback evidence or an anonymous review", () => {
    expect(() =>
      parseTextRolloutEvidence({
        PET_SEARCH_TEXT_FALLBACK_HTTP_STATUSES: "200,200",
        PET_SEARCH_TEXT_HOLDOUT_REVIEWED_BY: "reviewer@example.com",
      }),
    ).toThrow(/three/i);
    expect(() =>
      parseTextRolloutEvidence({
        PET_SEARCH_TEXT_FALLBACK_HTTP_STATUSES: "200,invalid,200,200",
        PET_SEARCH_TEXT_HOLDOUT_REVIEWED_BY: "reviewer@example.com",
      }),
    ).toThrow(/three/i);
    expect(() =>
      parseTextRolloutEvidence({
        PET_SEARCH_TEXT_FALLBACK_HTTP_STATUSES: "200,200,200",
      }),
    ).toThrow(/reviewer/i);
  });
});
