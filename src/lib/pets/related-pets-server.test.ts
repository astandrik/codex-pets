import { beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import {
  createRelatedPetsResolver,
  logRelatedPetsResolverDiagnostic,
  type RelatedPetsResolverDependencies,
} from "@/lib/pets/related-pets-server";
import type { RelatedPetCandidate } from "@/lib/pets/related-pets";
import type {
  RelatedPetsSnapshot,
  RelatedPetsState,
} from "@/lib/pets/related-pets-repository";

const current = {
  slug: "source",
  kind: "creature" as const,
  tags: ["alpha"],
};

const candidates: RelatedPetCandidate[] = [
  candidate("source", "creature", ["alpha"], "2026-01-01"),
  candidate("a", "creature", ["alpha"], "2026-01-02"),
  candidate("b", "object", ["alpha"], "2026-01-05"),
  candidate("c", "creature", ["beta"], "2026-01-04"),
  candidate("d", "object", ["beta"], "2026-01-06"),
  candidate("e", "creature", ["alpha"], "2026-01-03"),
];

const readyState: RelatedPetsState = {
  requestedGenerationId: "9f87654d-1234-4abc-8def-1234567890ab",
  activeGenerationId: "9f87654d-1234-4abc-8def-1234567890ab",
  previousGenerationId: "87654321-4321-4abc-8def-1234567890ab",
  status: "ready",
  rankingRevision: CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision,
  failureReason: null,
  updatedAt: "2026-08-03T10:00:00.000Z",
};

const readySnapshot: RelatedPetsSnapshot = {
  generationId: "9f87654d-1234-4abc-8def-1234567890ab",
  sourceSlug: "source",
  rankingRevision: CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision,
  relatedSlugs: ["b", "missing", "b", "source", "d"],
  createdAt: "2026-08-03T10:00:00.000Z",
};

function candidate(
  slug: string,
  kind: RelatedPetCandidate["kind"],
  tags: string[],
  approvedAt: string,
): RelatedPetCandidate {
  return {
    slug,
    displayName: slug.toUpperCase(),
    kind,
    tags,
    description: `${slug} description`,
    approvedAt,
    createdAt: approvedAt,
  };
}

function dependencies(
  overrides: Partial<RelatedPetsResolverDependencies> = {},
): RelatedPetsResolverDependencies {
  return {
    getCandidates: vi.fn(async () => candidates),
    getState: vi.fn(async () => readyState),
    getSnapshot: vi.fn(async () => readySnapshot),
    getHybridEnabledValue: () => undefined,
    nowMs: () => 0,
    log: vi.fn(),
    ...overrides,
  };
}

describe("createRelatedPetsResolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rehydrates a ready snapshot from approved candidates and fills four unique cards", async () => {
    const nowMs = vi
      .fn<() => number>()
      .mockReturnValueOnce(100)
      .mockReturnValueOnce(107);
    const deps = dependencies({ nowMs });
    const resolveRelatedPets = createRelatedPetsResolver(deps);

    const result = await resolveRelatedPets(current);

    expect(result.map((pet) => pet.slug)).toEqual(["b", "d", "e", "a"]);
    expect(deps.getSnapshot).toHaveBeenCalledWith(
      "9f87654d-1234-4abc-8def-1234567890ab",
      "source",
    );
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("info", {
      operation: "snapshot-read",
      status: "ready",
      reason: "snapshot-current",
      generationCategory: "active",
      generationId: "9f87654d-1234-4abc-8def-1234567890ab",
      generationStatus: "ready",
      durationMs: 7,
    });
  });

  it.each([
    [
      "building",
      { status: "building" as const },
      {
        reason: "state-not-ready",
        generationCategory: "active",
        generationStatus: "building",
      },
    ],
    [
      "failed",
      { status: "failed" as const },
      {
        reason: "state-not-ready",
        generationCategory: "active",
        generationStatus: "failed",
      },
    ],
    [
      "missing active generation",
      { activeGenerationId: null },
      {
        reason: "active-generation-missing",
        generationCategory: "missing",
        generationStatus: "ready",
      },
    ],
    [
      "stale state revision",
      { rankingRevision: "stale-revision" },
      {
        reason: "ranking-revision-incompatible",
        generationCategory: "active",
        generationStatus: "ready",
      },
    ],
  ])("uses heuristic order for %s state", async (
    _name,
    stateOverride,
    expectedDiagnostic,
  ) => {
    const deps = dependencies({
      getState: vi.fn(async () => ({ ...readyState, ...stateOverride })),
    });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.getSnapshot).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith("warn", {
      operation: "state-fallback",
      status: "heuristic",
      ...expectedDiagnostic,
    });
    expect(vi.mocked(deps.log).mock.calls[0]?.[1]).not.toHaveProperty(
      "durationMs",
    );
  });

  it("uses heuristic order when state is missing", async () => {
    const deps = dependencies({ getState: vi.fn(async () => null) });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.getSnapshot).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith("warn", {
      operation: "state-fallback",
      status: "heuristic",
      reason: "state-missing",
      generationCategory: "missing",
      generationStatus: "missing",
    });
    expect(vi.mocked(deps.log).mock.calls[0]?.[1]).not.toHaveProperty(
      "durationMs",
    );
  });

  it.each([
    ["generation", { generationId: "wrong-generation" }],
    ["source", { sourceSlug: "wrong-source" }],
    ["revision", { rankingRevision: "stale-revision" }],
  ])("uses heuristic order for an incompatible snapshot %s", async (
    _name,
    snapshotOverride,
  ) => {
    const deps = dependencies({
      getSnapshot: vi.fn(async () => ({
        ...readySnapshot,
        ...snapshotOverride,
      })),
    });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("warn", {
      operation: "snapshot-read",
      status: "heuristic",
      reason: "snapshot-incompatible",
      generationCategory: "active",
      generationId: "9f87654d-1234-4abc-8def-1234567890ab",
      generationStatus: "ready",
      durationMs: 0,
    });
  });

  it("uses heuristic order when the snapshot is missing", async () => {
    const deps = dependencies({ getSnapshot: vi.fn(async () => null) });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith("warn", {
      operation: "snapshot-read",
      status: "heuristic",
      reason: "snapshot-missing",
      generationCategory: "active",
      generationId: "9f87654d-1234-4abc-8def-1234567890ab",
      generationStatus: "ready",
      durationMs: 0,
    });
  });

  it.each(["state", "snapshot"])(
    "uses heuristic order when the %s read fails without logging error details",
    async (read) => {
      const nowMs = vi
        .fn<() => number>()
        .mockReturnValueOnce(200)
        .mockReturnValueOnce(215);
      const deps = dependencies({
        ...(read === "state"
          ? {
              getState: vi.fn(async () =>
                Promise.reject(new Error("secret state error")),
              ),
            }
          : {
              getSnapshot: vi.fn(async () =>
                Promise.reject(new Error("secret malformed JSON")),
              ),
            }),
        nowMs,
      });

      const result = await createRelatedPetsResolver(deps)(current);

      expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
      expect(deps.log).toHaveBeenCalledTimes(1);
      expect(deps.log).toHaveBeenCalledWith(
        "warn",
        read === "state"
          ? {
              operation: "resolve",
              status: "heuristic",
              reason: "state-read-failed",
            }
          : {
              operation: "snapshot-read",
              status: "heuristic",
              reason: "snapshot-read-failed",
              generationCategory: "active",
              generationId: "9f87654d-1234-4abc-8def-1234567890ab",
              generationStatus: "ready",
              durationMs: 15,
            },
      );
      expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(
        "secret",
      );
    },
  );

  it("uses heuristic order without snapshot reads when hybrid is disabled", async () => {
    const deps = dependencies({ getHybridEnabledValue: () => "false" });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.getState).not.toHaveBeenCalled();
    expect(deps.getSnapshot).not.toHaveBeenCalled();
  });

  it("enables hybrid for unset and exact true values", async () => {
    for (const value of [undefined, "true"]) {
      const deps = dependencies({ getHybridEnabledValue: () => value });

      const result = await createRelatedPetsResolver(deps)(current);

      expect(result.map((pet) => pet.slug)).toEqual(["b", "d", "e", "a"]);
    }
  });

  it("fails an invalid flag safely to heuristic with a bounded diagnostic", async () => {
    const deps = dependencies({
      getHybridEnabledValue: () => "TRUE-secret-value",
    });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.getState).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith("warn", {
      operation: "resolve",
      status: "heuristic",
      reason: "invalid-enabled-flag",
    });
    expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(
      "TRUE-secret-value",
    );
  });

  it.each([
    ["invalid", "secret-generation"],
    [
      "unbounded",
      `9f87654d-1234-4abc-8def-1234567890ab-${"x".repeat(200)}`,
    ],
  ])(
    "replaces an %s active generation id with a fixed marker",
    async (_caseName, unsafeGenerationId) => {
      const deps = dependencies({
        getState: vi.fn(async () => ({
          ...readyState,
          requestedGenerationId: unsafeGenerationId,
          activeGenerationId: unsafeGenerationId,
        })),
        getSnapshot: vi.fn(async () => ({
          ...readySnapshot,
          generationId: unsafeGenerationId,
        })),
      });

      await createRelatedPetsResolver(deps)(current);

      expect(deps.log).toHaveBeenCalledWith(
        "info",
        expect.objectContaining({
          generationId: "invalid-generation-id",
        }),
      );
      expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(
        unsafeGenerationId,
      );
    },
  );

  it("uses info for successful production snapshot diagnostics and warn for fallbacks", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const successfulDiagnostic = {
      operation: "snapshot-read" as const,
      status: "ready" as const,
      reason: "snapshot-current" as const,
      generationCategory: "active" as const,
      generationId: "9f87654d-1234-4abc-8def-1234567890ab",
      generationStatus: "ready" as const,
      durationMs: 7,
    };
    const fallbackDiagnostic = {
      operation: "state-fallback" as const,
      status: "heuristic" as const,
      reason: "state-missing" as const,
      generationCategory: "missing" as const,
      generationStatus: "missing" as const,
    };

    logRelatedPetsResolverDiagnostic("info", successfulDiagnostic);
    logRelatedPetsResolverDiagnostic("warn", fallbackDiagnostic);

    expect(info).toHaveBeenCalledWith(
      "[codex-pets][related-pets]",
      successfulDiagnostic,
    );
    expect(warn).toHaveBeenCalledWith(
      "[codex-pets][related-pets]",
      fallbackDiagnostic,
    );
    info.mockRestore();
    warn.mockRestore();
  });
});
