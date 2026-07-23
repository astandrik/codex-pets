import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PET_SEARCH_LABEL_POOL_VERSION,
  buildPetSearchLabelPool,
  renderPetSearchLabelPoolHtml,
  validatePetSearchLabelPoolJudgments,
  writePetSearchLabelPoolBundle,
  type PetSearchLabelPoolCandidate,
  type PetSearchLabelPoolJudgmentRecord,
} from "@/lib/pets/search-eval-label-pool";

describe("blinded pet search label pools", () => {
  it("unions the first ten candidates from every ranker with a stable sample", () => {
    const catalog = createCatalog(60);
    const input = {
      queryId: "visual-calibration-sexy",
      suite: "visual-calibration-v2" as const,
      query: "sexy",
      catalog,
      rankings: {
        lexical: slugs(0, 12),
        text: slugs(8, 12),
        visualV1: slugs(16, 12),
        visualV2: slugs(24, 12),
      },
    };

    const first = buildPetSearchLabelPool(input);
    const second = buildPetSearchLabelPool({
      ...input,
      catalog: [...catalog].reverse(),
    });
    const selected = new Set(first.candidates.map((candidate) => candidate.slug));

    for (const source of Object.values(input.rankings)) {
      for (const slug of source.slice(0, 10)) {
        expect(selected.has(slug)).toBe(true);
      }
    }
    expect(first.candidates.length).toBeGreaterThanOrEqual(34);
    expect(first.candidates.length).toBeLessThanOrEqual(44);
    expect(selected.size).toBe(first.candidates.length);
    expect(first).toEqual(second);
    expect(first.poolVersion).toBe(PET_SEARCH_LABEL_POOL_VERSION);
    expect(first.candidatePoolHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds the pool hash and display order to spritesheet content", () => {
    const catalog = createCatalog(20);
    const input = {
      queryId: "text-gothic-anime-woman",
      suite: "text-regression-v2" as const,
      query: "gothic anime woman",
      catalog,
      rankings: {
        lexical: slugs(0, 10),
        text: [],
        visualV1: [],
        visualV2: [],
      },
    };
    const original = buildPetSearchLabelPool(input);
    const changed = buildPetSearchLabelPool({
      ...input,
      catalog: catalog.map((candidate, index) =>
        index === 0
          ? { ...candidate, spritesheetSha256: "f".repeat(64) }
          : candidate,
      ),
    });

    expect(changed.candidatePoolHash).not.toBe(original.candidatePoolHash);
    expect(changed.candidates.map((candidate) => candidate.slug)).not.toEqual(
      original.candidates.map((candidate) => candidate.slug),
    );
  });

  it("renders only blinded identity and four-frame evidence", () => {
    const candidate = {
      ...createCatalog(1)[0],
      displayName: `Pet </script><script>alert("metadata")</script>`,
      description: "forbidden-description",
      tags: ["forbidden-tag"],
      caption: "forbidden-caption",
      score: 0.99,
      rankSource: "visual-v2",
    } as PetSearchLabelPoolCandidate & Record<string, unknown>;
    const pool = buildPetSearchLabelPool({
      queryId: "visual-calibration-sexy",
      suite: "visual-calibration-v2",
      query: "sexy",
      catalog: [candidate],
      rankings: {
        lexical: [candidate.slug],
        text: [],
        visualV1: [],
        visualV2: [],
      },
    });
    const html = renderPetSearchLabelPoolHtml([pool]);

    expect(html).toContain("sexy");
    expect(html).toContain(candidate.slug);
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain("forbidden-description");
    expect(html).not.toContain("forbidden-tag");
    expect(html).not.toContain("forbidden-caption");
    expect(html).not.toContain("rankSource");
    expect(html).not.toContain(candidate.spritesheetSha256);
    expect(html.match(/data:image\/png;base64/g)).toHaveLength(4);
  });

  it("rejects incomplete, stale, or malformed judgment exports", () => {
    const pool = buildPetSearchLabelPool({
      queryId: "visual-calibration-sexy",
      suite: "visual-calibration-v2",
      query: "sexy",
      catalog: createCatalog(2),
      rankings: {
        lexical: slugs(0, 2),
        text: [],
        visualV1: [],
        visualV2: [],
      },
    });
    const valid = judgmentRecord(pool);

    expect(() =>
      validatePetSearchLabelPoolJudgments([pool], [valid]),
    ).not.toThrow();
    expect(() =>
      validatePetSearchLabelPoolJudgments(
        [pool],
        [{ ...valid, judgments: valid.judgments.slice(1) }],
      ),
    ).toThrow(/incomplete/i);
    expect(() =>
      validatePetSearchLabelPoolJudgments(
        [pool],
        [{ ...valid, candidatePoolHash: "0".repeat(64) }],
      ),
    ).toThrow(/pool hash mismatch/i);
    expect(() =>
      validatePetSearchLabelPoolJudgments(
        [pool],
        [{ ...valid, reviewer: " " }],
      ),
    ).toThrow(/reviewer/i);
  });

  it("writes only into a new or explicitly empty output directory", async () => {
    const parent = await mkdtemp(
      join(tmpdir(), "codex-pets-label-pool-test-"),
    );
    const outputDirectory = join(parent, "bundle");
    const pool = buildPetSearchLabelPool({
      queryId: "visual-calibration-sexy",
      suite: "visual-calibration-v2",
      query: "sexy",
      catalog: createCatalog(1),
      rankings: {
        lexical: slugs(0, 1),
        text: [],
        visualV1: [],
        visualV2: [],
      },
    });

    try {
      await writePetSearchLabelPoolBundle({
        outputDirectory,
        pools: [pool],
      });
      expect(await readFile(join(outputDirectory, "index.html"), "utf8"))
        .toContain("Codex Pets blinded relevance review");
      await expect(
        writePetSearchLabelPoolBundle({
          outputDirectory,
          pools: [pool],
        }),
      ).rejects.toThrow(/empty directory/i);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});

function createCatalog(count: number): PetSearchLabelPoolCandidate[] {
  return Array.from({ length: count }, (_, index) => ({
    slug: `pet-${String(index).padStart(2, "0")}`,
    displayName: `Pet ${index}`,
    spritesheetSha256: index.toString(16).padStart(64, "0"),
    frameDataUrls: [
      `data:image/png;base64,a${index}`,
      `data:image/png;base64,b${index}`,
      `data:image/png;base64,c${index}`,
      `data:image/png;base64,d${index}`,
    ],
  }));
}

function slugs(start: number, count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `pet-${String(start + index).padStart(2, "0")}`,
  );
}

function judgmentRecord(
  pool: ReturnType<typeof buildPetSearchLabelPool>,
): PetSearchLabelPoolJudgmentRecord {
  return {
    poolVersion: pool.poolVersion,
    queryId: pool.queryId,
    suite: pool.suite,
    query: pool.query,
    candidatePoolHash: pool.candidatePoolHash,
    candidateRecords: pool.candidates.map((candidate) => ({
      slug: candidate.slug,
      spritesheetSha256: candidate.spritesheetSha256,
    })),
    reviewer: "reviewer",
    reviewedAt: "2026-07-23T12:00:00.000Z",
    judgments: pool.candidates.map((candidate, index) => ({
      slug: candidate.slug,
      judgment: index === 0 ? "relevant" as const : "irrelevant" as const,
    })),
  };
}
