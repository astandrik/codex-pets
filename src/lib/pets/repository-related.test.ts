import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const executeQuery = vi.fn();
  return {
    executeQuery,
    isYdbConfigured: vi.fn(() => true),
    rowsFromResult: vi.fn(),
    textAt: vi.fn((row: { items?: Array<{ textValue?: string }> }, index: number) =>
      row.items?.[index]?.textValue ?? "",
    ),
    withSession: vi.fn((callback) => callback({ executeQuery })),
  };
});

vi.mock("@/lib/ydb/client", () => ({
  TypedValues: {
    utf8: (value: string) => ({ kind: "utf8", value }),
  },
  isYdbConfigured: mocks.isYdbConfigured,
  withSession: mocks.withSession,
}));

vi.mock("@/lib/ydb/result", () => ({
  rowsFromResult: mocks.rowsFromResult,
  textAt: mocks.textAt,
  uintAt: vi.fn(),
}));

import { listRelatedPetCandidates } from "@/lib/pets/repository";

describe("listRelatedPetCandidates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.isYdbConfigured.mockReturnValue(true);
    mocks.executeQuery.mockResolvedValue({ resultSets: [] });
    mocks.rowsFromResult.mockReturnValue([]);
    mocks.withSession.mockImplementation((callback) =>
      callback({ executeQuery: mocks.executeQuery }),
    );
  });

  it("runs a light approved-only query without metrics or profile joins", async () => {
    mocks.rowsFromResult.mockReturnValueOnce([
      {
        items: [
          { textValue: "orbit-otter" },
          { textValue: "Orbit Otter" },
          { textValue: "creature" },
          { textValue: '["space","friendly"]' },
          { textValue: "A compact space helper." },
          { textValue: "2026-05-04T10:00:00.000Z" },
          { textValue: "2026-05-02T10:00:00.000Z" },
        ],
      },
      {
        items: [
          { textValue: "late-pet" },
          { textValue: "Late Pet" },
          { textValue: "unknown-kind" },
          { textValue: "not-json" },
          { textValue: "" },
          { textValue: "" },
          { textValue: "2026-06-01T00:00:00.000Z" },
        ],
      },
    ]);

    const candidates = await listRelatedPetCandidates();

    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    const [statement, params] = mocks.executeQuery.mock.calls[0];
    expect(statement).toContain(
      "SELECT slug, display_name, kind, tags_json, description, approved_at, created_at",
    );
    expect(statement).toContain("WHERE status = $status");
    expect(statement).not.toContain("metrics");
    expect(statement).not.toContain("download_count");
    expect(statement).not.toContain("owner");
    expect(params).toEqual({
      $status: { kind: "utf8", value: "approved" },
    });
    expect(candidates).toEqual([
      {
        slug: "orbit-otter",
        displayName: "Orbit Otter",
        kind: "creature",
        tags: ["space", "friendly"],
        description: "A compact space helper.",
        approvedAt: "2026-05-04T10:00:00.000Z",
        createdAt: "2026-05-02T10:00:00.000Z",
      },
      {
        slug: "late-pet",
        displayName: "Late Pet",
        kind: "creature",
        tags: [],
        description: "",
        approvedAt: null,
        createdAt: "2026-06-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list when YDB is not configured", async () => {
    mocks.isYdbConfigured.mockReturnValue(false);

    await expect(listRelatedPetCandidates()).resolves.toEqual([]);
    expect(mocks.executeQuery).not.toHaveBeenCalled();
  });

  it("maps approved mock records without touching YDB", async () => {
    vi.stubEnv("CODEX_PETS_DATA_SOURCE", "mock");

    const candidates = await listRelatedPetCandidates();

    expect(mocks.executeQuery).not.toHaveBeenCalled();
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(Object.keys(candidate).sort()).toEqual([
        "approvedAt",
        "createdAt",
        "description",
        "displayName",
        "kind",
        "slug",
        "tags",
      ]);
    }
    const slugs = candidates.map((candidate) => candidate.slug);
    expect(slugs).toContain("orbit-otter");
    expect(slugs).not.toContain("pending-pixel");
    expect(slugs).not.toContain("rejected-spark");
  });
});
