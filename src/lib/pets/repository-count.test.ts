import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const executeQuery = vi.fn();
  return {
    executeQuery,
    isYdbConfigured: vi.fn(() => true),
    rowsFromResult: vi.fn(),
    uintAt: vi.fn(),
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
  textAt: vi.fn(),
  uintAt: mocks.uintAt,
}));

import { countApprovedPets } from "@/lib/pets/repository";

describe("approved pet count", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isYdbConfigured.mockReturnValue(true);
    mocks.executeQuery.mockResolvedValue({ resultSets: [] });
    mocks.rowsFromResult.mockReturnValue([]);
    mocks.uintAt.mockReturnValue(0);
    mocks.withSession.mockImplementation((callback) =>
      callback({ executeQuery: mocks.executeQuery }),
    );
  });

  it("returns the uncapped aggregate approved count", async () => {
    const row = { items: [{ uint64Value: "201" }] };
    mocks.rowsFromResult.mockReturnValueOnce([row]);
    mocks.uintAt.mockReturnValueOnce(201);

    await expect(countApprovedPets()).resolves.toBe(201);

    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    const [statement, params] = mocks.executeQuery.mock.calls[0];
    expect(statement).toContain("SELECT COUNT(*) AS approved_count");
    expect(statement).toContain("WHERE status = $status");
    expect(statement).not.toContain("LIMIT");
    expect(params).toEqual({
      $status: { kind: "utf8", value: "approved" },
    });
  });
});
