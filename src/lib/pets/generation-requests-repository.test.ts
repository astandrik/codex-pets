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

import {
  countOpenGenerationRequests,
  listGenerationRequestsForUser,
  listGenerationRequests,
} from "@/lib/pets/generation-requests-repository";

describe("pet generation request repository", () => {
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

  it("counts open requests with an uncapped aggregate query", async () => {
    const row = { items: [{ uint64Value: "7" }] };
    mocks.rowsFromResult.mockReturnValueOnce([row]);
    mocks.uintAt.mockReturnValueOnce(7);

    await expect(countOpenGenerationRequests()).resolves.toBe(7);

    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    const [statement, params] = mocks.executeQuery.mock.calls[0];
    expect(statement).toContain("SELECT COUNT(*) AS open_count");
    expect(statement).toContain("status = $pending_status");
    expect(statement).toContain("status = $in_progress_status");
    expect(statement).not.toContain("LIMIT");
    expect(params).toEqual({
      $pending_status: { kind: "utf8", value: "pending" },
      $in_progress_status: { kind: "utf8", value: "in_progress" },
    });
  });

  it("prioritizes open requests in the capped admin list", async () => {
    await listGenerationRequests();

    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    const [statement, params] = mocks.executeQuery.mock.calls[0];
    expect(statement).toContain("CASE");
    expect(statement).toContain("WHEN r.status = $pending_status THEN 0");
    expect(statement).toContain("WHEN r.status = $in_progress_status THEN 0");
    expect(statement).toContain("LEFT JOIN codex_pet_generation_request_images");
    expect(statement).toContain("LIMIT 200");
    expect(params).toEqual({
      $deleted_status: { kind: "utf8", value: "deleted" },
      $pending_status: { kind: "utf8", value: "pending" },
      $in_progress_status: { kind: "utf8", value: "in_progress" },
    });
  });

  it("lists only requests created by the current user", async () => {
    await listGenerationRequestsForUser("user_1");

    expect(mocks.executeQuery).toHaveBeenCalledTimes(1);
    const [statement, params] = mocks.executeQuery.mock.calls[0];
    expect(statement).toContain("r.requester_user_id = $requester_user_id");
    expect(statement).toContain("r.status != $deleted_status");
    expect(statement).toContain("LEFT JOIN codex_pet_generation_request_images");
    expect(params).toEqual({
      $requester_user_id: { kind: "utf8", value: "user_1" },
      $deleted_status: { kind: "utf8", value: "deleted" },
    });
  });
});
