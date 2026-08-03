import { describe, expect, it } from "vitest";

import {
  createBlindCaptionReviewArtifact,
  parseCompletedBlindCaptionReviews,
  selectEligibleCaptionRevisions,
} from "./lib/pet-caption-bakeoff.mjs";

const caption = {
  subject: { en: "robot", ru: "робот" },
  appearance: { en: "metal body", ru: "металлический корпус" },
  clothing: { en: "", ru: "" },
  style: { en: "pixel art", ru: "пиксель-арт" },
  mood: { en: "friendly", ru: "дружелюбный" },
  colors: { en: ["blue"], ru: ["синий"] },
  search_terms_en: ["small robot", "pixel art", "friendly"],
  search_terms_ru: ["маленький робот", "пиксель-арт", "дружелюбный"],
};

describe("blind caption bakeoff artifact", () => {
  it("derives eligible candidates only from a valid managed preflight", () => {
    const passingPreflight = {
      modelsApi: true,
      qwenAvailable: true,
      embeddingsV2: true,
      embeddingDimensions: 768,
      deepSeekEligible: true,
    };
    expect(
      selectEligibleCaptionRevisions(
        passingPreflight,
        "qwen",
        "deepseek",
      ),
    ).toEqual(["qwen", "deepseek"]);
    expect(
      selectEligibleCaptionRevisions(
        { ...passingPreflight, deepSeekEligible: false },
        "qwen",
        "deepseek",
      ),
    ).toEqual(["qwen"]);
    expect(() =>
      selectEligibleCaptionRevisions({}, "qwen", "deepseek"),
    ).toThrow(/preflight/i);
  });

  it("supports a Qwen-only review when preflight excludes DeepSeek", () => {
    const artifact = createBlindCaptionReviewArtifact({
      candidateRevisions: ["qwen"],
      pets: [
        {
          slug: "orbit-otter",
          frameFiles: ["idle.png", "run.png", "wave.png", "review.png"],
          captions: { qwen: caption },
        },
      ],
    });

    expect(artifact.review.items[0]?.candidates).toHaveLength(1);
    expect(artifact.key.items[0]?.candidates).toEqual([
      { label: "A", captionRevision: "qwen" },
    ]);
    const reviewedCandidate = artifact.review.items[0]!.candidates[0]!;
    reviewedCandidate.unsupportedFact = false;
    reviewedCandidate.bilingualContradiction = false;
    reviewedCandidate.coverage = 4;
    reviewedCandidate.searchUtility = 5;
    expect(
      parseCompletedBlindCaptionReviews(artifact.review, artifact.key),
    ).toEqual([
      expect.objectContaining({
        petSlug: "orbit-otter",
        captionRevision: "qwen",
      }),
    ]);
  });

  it("hides revisions and pet identity while requiring all four review scores", () => {
    const artifact = createBlindCaptionReviewArtifact({
      candidateRevisions: ["qwen", "deepseek"],
      pets: [
        {
          slug: "orbit-otter",
          frameFiles: ["idle.png", "run.png", "wave.png", "review.png"],
          captions: {
            qwen: caption,
            deepseek: {
              ...caption,
              search_terms_en: ["blue robot", "pixel art", "friendly"],
            },
          },
        },
      ],
    });

    expect(artifact.review).toMatchObject({
      schemaVersion: 1,
      items: [
        {
          reviewId: "pet-001",
          frameFiles: ["idle.png", "run.png", "wave.png", "review.png"],
          candidates: [
            {
              label: expect.stringMatching(/^[AB]$/),
              unsupportedFact: null,
              bilingualContradiction: null,
              coverage: null,
              searchUtility: null,
            },
            {
              label: expect.stringMatching(/^[AB]$/),
              unsupportedFact: null,
              bilingualContradiction: null,
              coverage: null,
              searchUtility: null,
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(artifact.review)).not.toContain("orbit-otter");
    expect(JSON.stringify(artifact.review)).not.toContain("qwen");
    expect(JSON.stringify(artifact.review)).not.toContain("deepseek");
    expect(artifact.key).toMatchObject({
      items: [
        {
          reviewId: "pet-001",
          petSlug: "orbit-otter",
          candidates: expect.arrayContaining([
            { label: expect.any(String), captionRevision: "qwen" },
            { label: expect.any(String), captionRevision: "deepseek" },
          ]),
        },
      ],
    });

    for (const candidate of artifact.review.items[0]!.candidates) {
      candidate.unsupportedFact = false;
      candidate.bilingualContradiction = false;
      candidate.coverage = 4;
      candidate.searchUtility = 5;
    }
    expect(
      parseCompletedBlindCaptionReviews(artifact.review, artifact.key),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          petSlug: "orbit-otter",
          captionRevision: "qwen",
          coverage: 4,
          searchUtility: 5,
        }),
        expect.objectContaining({
          petSlug: "orbit-otter",
          captionRevision: "deepseek",
          coverage: 4,
          searchUtility: 5,
        }),
      ]),
    );
  });

  it("excludes a candidate missing any approved-pet caption", () => {
    const artifact = createBlindCaptionReviewArtifact({
      candidateRevisions: ["qwen", "deepseek"],
      pets: [
        {
          slug: "orbit-otter",
          frameFiles: ["idle.png", "run.png", "wave.png", "review.png"],
          captions: { qwen: caption, deepseek: caption },
        },
        {
          slug: "signal-fox",
          frameFiles: ["idle-2.png", "run-2.png", "wave-2.png", "review-2.png"],
          captions: { qwen: caption },
        },
      ],
    });

    expect(
      artifact.review.items.map((item) => item.candidates.length),
    ).toEqual([1, 1]);
    expect(
      artifact.key.items.flatMap((item) =>
        item.candidates.map((candidate) => candidate.captionRevision),
      ),
    ).toEqual(["qwen", "qwen"]);
  });

  it("excludes a candidate with an invalid strict caption", () => {
    const artifact = createBlindCaptionReviewArtifact({
      candidateRevisions: ["qwen", "deepseek"],
      pets: [
        {
          slug: "orbit-otter",
          frameFiles: ["idle.png", "run.png", "wave.png", "review.png"],
          captions: {
            qwen: caption,
            deepseek: { ...caption, search_terms_en: [] },
          },
        },
      ],
    });

    expect(artifact.review.items[0]?.candidates).toHaveLength(1);
    expect(artifact.key.items[0]?.candidates).toEqual([
      { label: "A", captionRevision: "qwen" },
    ]);
  });

  it("rejects incomplete frame evidence", () => {
    expect(() =>
      createBlindCaptionReviewArtifact({
        candidateRevisions: ["qwen", "deepseek"],
        pets: [
          {
            slug: "orbit-otter",
            frameFiles: ["idle.png"],
            captions: { qwen: caption },
          },
        ],
      }),
    ).toThrow(/four frames|missing caption/i);
  });

  it("rejects incomplete or out-of-range review scores", () => {
    const artifact = createBlindCaptionReviewArtifact({
      candidateRevisions: ["qwen", "deepseek"],
      pets: [
        {
          slug: "orbit-otter",
          frameFiles: ["idle.png", "run.png", "wave.png", "review.png"],
          captions: { qwen: caption, deepseek: caption },
        },
      ],
    });

    expect(() =>
      parseCompletedBlindCaptionReviews(artifact.review, artifact.key),
    ).toThrow(/complete/i);
    artifact.review.items[0]!.candidates[0]!.unsupportedFact = false;
    artifact.review.items[0]!.candidates[0]!.bilingualContradiction = false;
    artifact.review.items[0]!.candidates[0]!.coverage = 6;
    artifact.review.items[0]!.candidates[0]!.searchUtility = 5;
    expect(() =>
      parseCompletedBlindCaptionReviews(artifact.review, artifact.key),
    ).toThrow(/complete/i);
  });
});
