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
    let mutationCall = 0;
    const executeQuery = vi.fn(async (query: string) => {
      if (query.includes("DELETE FROM codex_idempotency_keys")) return {};
      mutationCall += 1;
      if (mutationCall === 1) throw new Error("duplicate primary key");
      if (mutationCall === 2) {
        return ydbRecord({
          status: "in_progress",
          requestHash,
          updatedAt: "2026-05-29T10:00:00.000Z",
          claimToken: "stale-token",
        });
      }
      if (mutationCall === 3) return {};
      return ydbRecord({
        status: "in_progress",
        requestHash,
        updatedAt: "2026-05-29T10:10:01.000Z",
        claimToken: "winner-token",
      });
    });
    vi.mocked(withSession).mockImplementation(async (callback) =>
      callback({ executeQuery } as never),
    );

    const claim = await claimIdempotencyKey({
      route: "POST /test",
      key: "stale-ydb",
      requestHash,
    });

    expect(claim.kind).toBe("in_progress");
    expect(mutationCall).toBe(4);
  });

  it("claims a stale row after the conditional refresh is visible", async () => {
    const requestHash = hashIdempotencyPayload({ prompt: "same" });
    let mutationCall = 0;
    let refreshedAt = "";
    let claimToken = "";
    const executeQuery = vi.fn(
      async (query: string, params?: Record<string, string>) => {
        if (query.includes("DELETE FROM codex_idempotency_keys")) return {};
        mutationCall += 1;
        if (mutationCall === 1) throw new Error("duplicate primary key");
        if (mutationCall === 2) {
          return ydbRecord({
            status: "in_progress",
            requestHash,
            updatedAt: "2026-05-29T10:00:00.000Z",
            claimToken: "stale-token",
          });
        }
        if (mutationCall === 3) {
          refreshedAt = String(params?.$updated_at ?? "");
          claimToken = String(params?.$claim_token ?? "");
          return {};
        }
        return ydbRecord({
          status: "in_progress",
          requestHash,
          updatedAt: refreshedAt,
          claimToken,
        });
      },
    );
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
      claim: { claimToken },
    });
    expect(refreshedAt).toBe("2026-05-29T10:10:01.000Z");
    expect(claimToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(mutationCall).toBe(4);
  });
});

function ydbRecord(input: {
  status: "in_progress" | "completed";
  requestHash: string;
  updatedAt: string;
  claimToken: string;
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
              { textValue: "2026-05-29T10:00:00.000Z" },
              { textValue: input.updatedAt },
              { textValue: input.claimToken },
              { textValue: "2026-05-30T10:10:01.000Z" },
            ],
          },
        ],
      },
    ],
  };
}
