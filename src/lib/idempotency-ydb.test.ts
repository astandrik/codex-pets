import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/pets/mock-data", () => ({
  isMockPetsDataSource: vi.fn(() => false),
}));

vi.mock("@/lib/ydb/client", () => ({
  isYdbConfigured: vi.fn(() => true),
  TypedValues: {
    utf8: vi.fn((value: string) => value),
    uint32: vi.fn((value: number) => value),
  },
  withSession: vi.fn(),
}));

import {
  claimIdempotencyKey,
  hashIdempotencyPayload,
} from "@/lib/idempotency";
import { withSession } from "@/lib/ydb/client";

describe("YDB idempotency helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-29T10:10:01.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not claim a stale row unless the refresh is visible", async () => {
    const requestHash = hashIdempotencyPayload({ prompt: "same" });
    const executeQuery = vi.fn()
      .mockRejectedValueOnce(new Error("duplicate primary key"))
      .mockResolvedValueOnce(ydbRecord({
        status: "in_progress",
        requestHash,
        updatedAt: "2026-05-29T10:00:00.000Z",
      }))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(ydbRecord({
        status: "in_progress",
        requestHash,
        updatedAt: "2026-05-29T10:10:01.000Z#winner",
      }));
    vi.mocked(withSession).mockImplementation(async (callback) =>
      callback({ executeQuery } as never),
    );

    const claim = await claimIdempotencyKey({
      route: "POST /test",
      key: "stale-ydb",
      requestHash,
    });

    expect(claim.kind).toBe("in_progress");
    expect(executeQuery).toHaveBeenCalledTimes(4);
  });

  it("claims a stale row after the conditional refresh is visible", async () => {
    const requestHash = hashIdempotencyPayload({ prompt: "same" });
    let call = 0;
    let refreshedAt = "";
    const executeQuery = vi.fn(async (_query: string, params?: Record<string, string>) => {
      call += 1;
      if (call === 1) throw new Error("duplicate primary key");
      if (call === 2) {
        return ydbRecord({
          status: "in_progress",
          requestHash,
          updatedAt: "2026-05-29T10:00:00.000Z",
        });
      }
      if (call === 3) {
        refreshedAt = String(params?.$updated_at ?? "");
        return {};
      }
      return ydbRecord({
        status: "in_progress",
        requestHash,
        updatedAt: refreshedAt,
      });
    });
    vi.mocked(withSession).mockImplementation(async (callback) =>
      callback({ executeQuery } as never),
    );

    const claim = await claimIdempotencyKey({
      route: "POST /test",
      key: "stale-ydb-visible-refresh",
      requestHash,
    });

    expect(claim).toEqual({
      kind: "fresh",
      claim: { updatedAt: refreshedAt },
    });
    expect(refreshedAt).toMatch(
      /^2026-05-29T10:10:01\.000Z#[0-9a-f-]{36}$/,
    );
    expect(executeQuery).toHaveBeenCalledTimes(4);
  });
});

function ydbRecord(input: {
  status: "in_progress" | "completed";
  requestHash: string;
  updatedAt: string;
}) {
  return {
    resultSets: [
      {
        rows: [
          {
            items: [
              { textValue: input.status },
              { textValue: input.requestHash },
              { uint32Value: 0 },
              { textValue: "" },
              { textValue: input.updatedAt },
            ],
          },
        ],
      },
    ],
  };
}
