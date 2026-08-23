import { describe, expect, it, vi } from "vitest";

import { runRelatedPetsV24Verification } from "./verify-related-pets-v24.mjs";

const rankingRevision = "ranking-v24";
const rankings = [
  { sourceSlug: "a", relatedSlugs: ["b", "c"] },
  { sourceSlug: "b", relatedSlugs: ["a", "c"] },
  { sourceSlug: "c", relatedSlugs: ["a", "b"] },
];
const candidates = ["a", "b", "c"].map((slug) => ({
  slug,
  displayName: slug.toUpperCase(),
  description: `${slug} description`,
  kind: "character",
  tags: ["test"],
  createdAt: "2026-08-15T00:00:00.000Z",
  approvedAt: "2026-08-15T00:00:00.000Z",
}));

function service(overrides = {}) {
  return {
    rebuild: vi.fn(async () => ({
      coverage: {
        approvedPetCount: 3,
        snapshotCount: 3,
        textVectorCount: 3,
        annotationCount: 3,
        annotationVectorCount: 3,
        visualVectorCount: 3,
      },
      rankings,
    })),
    getState: vi.fn(async () => ({
      status: "ready",
      activeGenerationId: "generation-v24",
      rankingRevision,
    })),
    listSnapshots: vi.fn(async () => rankings.map((ranking) => ({
      ...ranking,
      generationId: "generation-v24",
      rankingRevision,
      createdAt: "2026-08-15T00:00:00.000Z",
    }))),
    listCandidates: vi.fn(async () => candidates),
    rankingRevision,
    dispose: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("related:verify:v24", () => {
  it("verifies exact ordered snapshots without writes", async () => {
    const runtime = service();
    const lines: Array<Record<string, unknown>> = [];

    await expect(runRelatedPetsV24Verification({
      loadService: async () => runtime,
      write: (line: string) => lines.push(
        JSON.parse(line) as Record<string, unknown>,
      ),
    })).resolves.toBe(0);

    expect(runtime.rebuild).toHaveBeenCalledWith({
      mode: "dry-run",
      includeVisual: true,
    });
    expect(lines).toEqual([
      expect.objectContaining({
        status: "verified",
        catalogFingerprint:
          "b509431de0ff413f8a7ae12c7ca8e25fb68fc880c2c2bac4dc69f27fbad81a91",
        mismatchedSources: [],
        integrityFailures: [],
      }),
    ]);
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it("fails when one materialized order differs", async () => {
    const runtime = service({
      listSnapshots: vi.fn(async () => rankings.map((ranking, index) => ({
        ...ranking,
        relatedSlugs: index === 0 ? ["c", "b"] : ranking.relatedSlugs,
        generationId: "generation-v24",
        rankingRevision,
        createdAt: "2026-08-15T00:00:00.000Z",
      }))),
    });
    const lines: Array<Record<string, unknown>> = [];

    await expect(runRelatedPetsV24Verification({
      loadService: async () => runtime,
      write: (line: string) => lines.push(
        JSON.parse(line) as Record<string, unknown>,
      ),
    })).resolves.toBe(1);
    expect(lines).toEqual([
      expect.objectContaining({ status: "failed", mismatchedSources: ["a"] }),
    ]);
  });

  it("reports materialized sources that are absent from the dry-run", async () => {
    const runtime = service({
      listSnapshots: vi.fn(async () => [
        ...rankings.map((ranking) => ({
          ...ranking,
          generationId: "generation-v24",
          rankingRevision,
          createdAt: "2026-08-15T00:00:00.000Z",
        })),
        {
          sourceSlug: "extra",
          relatedSlugs: ["a", "b"],
          generationId: "generation-v24",
          rankingRevision,
          createdAt: "2026-08-15T00:00:00.000Z",
        },
      ]),
    });
    const lines: Array<Record<string, unknown>> = [];

    await expect(runRelatedPetsV24Verification({
      loadService: async () => runtime,
      write: (line: string) => lines.push(
        JSON.parse(line) as Record<string, unknown>,
      ),
    })).resolves.toBe(1);
    expect(lines).toEqual([
      expect.objectContaining({
        status: "failed",
        mismatchedSources: ["extra"],
      }),
    ]);
  });

  it("fails when the active generation changes during verification", async () => {
    const getState = vi.fn()
      .mockResolvedValueOnce({
        status: "ready",
        activeGenerationId: "generation-v24",
        rankingRevision,
      })
      .mockResolvedValueOnce({
        status: "ready",
        activeGenerationId: "generation-next",
        rankingRevision,
      });
    const runtime = service({ getState });
    const lines: Array<Record<string, unknown>> = [];

    await expect(runRelatedPetsV24Verification({
      loadService: async () => runtime,
      write: (line: string) => lines.push(
        JSON.parse(line) as Record<string, unknown>,
      ),
    })).resolves.toBe(1);
    expect(getState).toHaveBeenCalledTimes(2);
    expect(lines).toEqual([
      expect.objectContaining({
        status: "failed",
        failureReason: "active_generation_changed",
      }),
    ]);
  });

  it("rejects arguments and incompatible active generations", async () => {
    await expect(runRelatedPetsV24Verification({ argv: ["--apply"] }))
      .rejects.toThrow("does not accept arguments");
    await expect(runRelatedPetsV24Verification({
      loadService: async () => service({
        getState: vi.fn(async () => ({
          status: "ready",
          activeGenerationId: "generation-v24",
          rankingRevision: "stale",
        })),
      }),
    })).rejects.toThrow("active_generation_incompatible");
  });
});
