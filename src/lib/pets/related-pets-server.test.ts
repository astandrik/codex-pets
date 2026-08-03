import { beforeEach, describe, expect, it, vi } from "vitest";

import { CURRENT_RELATED_PETS_RANKING_PROFILE } from "@/lib/pets/related-pets-profile";
import {
  createRelatedPetsResolver,
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
  requestedGenerationId: "generation-ready",
  activeGenerationId: "generation-ready",
  previousGenerationId: "generation-old",
  status: "ready",
  rankingRevision: CURRENT_RELATED_PETS_RANKING_PROFILE.rankingRevision,
  failureReason: null,
  updatedAt: "2026-08-03T10:00:00.000Z",
};

const readySnapshot: RelatedPetsSnapshot = {
  generationId: "generation-ready",
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
      "generation-ready",
      "source",
    );
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith({
      operation: "snapshot-read",
      status: "ready",
      reason: "snapshot-current",
      generation: "active",
      generationStatus: "ready",
      durationMs: 7,
    });
  });

  it.each([
    ["building", { status: "building" as const }],
    ["failed", { status: "failed" as const }],
    ["missing active generation", { activeGenerationId: null }],
    ["stale state revision", { rankingRevision: "stale-revision" }],
  ])("uses heuristic order for %s state", async (_name, stateOverride) => {
    const deps = dependencies({
      getState: vi.fn(async () => ({ ...readyState, ...stateOverride })),
    });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.getSnapshot).not.toHaveBeenCalled();
    expect(deps.log).not.toHaveBeenCalled();
  });

  it("uses heuristic order when state is missing", async () => {
    const deps = dependencies({ getState: vi.fn(async () => null) });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.getSnapshot).not.toHaveBeenCalled();
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
    expect(deps.log).toHaveBeenCalledWith({
      operation: "snapshot-read",
      status: "heuristic",
      reason: "snapshot-incompatible",
      generation: "active",
      generationStatus: "ready",
      durationMs: 0,
    });
  });

  it("uses heuristic order when the snapshot is missing", async () => {
    const deps = dependencies({ getSnapshot: vi.fn(async () => null) });

    const result = await createRelatedPetsResolver(deps)(current);

    expect(result.map((pet) => pet.slug)).toEqual(["e", "a", "b", "c"]);
    expect(deps.log).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith({
      operation: "snapshot-read",
      status: "heuristic",
      reason: "snapshot-missing",
      generation: "active",
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
              generation: "active",
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
    expect(deps.log).toHaveBeenCalledWith({
      operation: "resolve",
      status: "heuristic",
      reason: "invalid-enabled-flag",
    });
    expect(JSON.stringify(vi.mocked(deps.log).mock.calls)).not.toContain(
      "TRUE-secret-value",
    );
  });
});
