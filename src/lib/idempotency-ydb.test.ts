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
  storeIdempotencyResult,
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

  it("recognizes a duplicate insert caused by its own retried claim", async () => {
    const requestHash = hashIdempotencyPayload({ prompt: "same" });
    let claimToken = "";
    const executeQuery = vi.fn(
      async (query: string, params?: Record<string, string>) => {
        if (query.includes("DELETE FROM codex_idempotency_keys")) return {};
        if (query.includes("INSERT INTO codex_idempotency_keys")) {
          claimToken = String(params?.$claim_token ?? "");
          throw new Error("duplicate primary key");
        }
        return ydbRecord({
          status: "in_progress",
          requestHash,
          updatedAt: "2026-05-29T10:10:01.000Z",
          claimToken,
        });
      },
    );
    vi.mocked(withSession).mockImplementation(async (callback) =>
      callback({ executeQuery } as never),
    );

    const claim = await claimIdempotencyKey({
      route: "POST /test",
      key: "own-retried-insert",
      requestHash,
    });

    expect(claim).toEqual({
      kind: "fresh",
      claim: { claimToken },
    });
  });

  it("holds a post-commit claim when result storage fails", async () => {
    vi.setSystemTime(new Date("2026-05-29T10:00:00.000Z"));
    const requestHash = hashIdempotencyPayload({ prompt: "same" });
    let stored: YdbRecordInput = {
      status: "in_progress",
      requestHash,
      updatedAt: "2026-05-29T10:00:00.000Z",
      claimToken: "post-commit-token",
      expiresAt: "2026-05-30T10:00:00.000Z",
    };
    const executeQuery = vi.fn(
      async (query: string, params?: Record<string, string>) => {
        if (query.includes("DELETE FROM codex_idempotency_keys")) return {};
        if (query.includes("INSERT INTO codex_idempotency_keys")) {
          throw new Error("duplicate primary key");
        }
        if (
          query.includes("UPDATE codex_idempotency_keys") &&
          query.includes("$completed_status")
        ) {
          throw new Error("transient result storage failure");
        }
        if (
          query.includes("UPDATE codex_idempotency_keys") &&
          query.includes("$committed_status")
        ) {
          stored = {
            status: "committed",
            requestHash,
            updatedAt: String(params?.$updated_at ?? ""),
            claimToken: "",
            expiresAt: String(params?.$expires_at ?? ""),
          };
          return {};
        }
        if (
          query.includes("UPDATE codex_idempotency_keys") &&
          query.includes("$previous_claim_token")
        ) {
          stored = {
            status: "in_progress",
            requestHash,
            updatedAt: String(params?.$updated_at ?? ""),
            claimToken: String(params?.$claim_token ?? ""),
            expiresAt: String(params?.$expires_at ?? ""),
          };
          return {};
        }
        return ydbRecord(stored);
      },
    );
    vi.mocked(withSession).mockImplementation(async (callback) =>
      callback({ executeQuery } as never),
    );

    const storedResult = await storeIdempotencyResult({
      route: "POST /test",
      key: "post-commit-store-failed",
      requestHash,
      claim: { claimToken: "post-commit-token" },
      statusCode: 201,
      responseBody: { ok: true, request: { id: "created" } },
    });
    vi.setSystemTime(new Date("2026-05-29T10:10:01.000Z"));
    const retry = await claimIdempotencyKey({
      route: "POST /test",
      key: "post-commit-store-failed",
      requestHash,
    });

    expect(storedResult).toBe(false);
    expect(stored.status).toBe("committed");
    expect(retry.kind).toBe("in_progress");
  });

  it("does not replay an expired YDB record left behind by cleanup", async () => {
    vi.setSystemTime(new Date("2026-05-30T10:00:01.000Z"));
    const requestHash = hashIdempotencyPayload({ prompt: "same" });
    let insertedClaimToken = "";
    let stored: YdbRecordInput | null = {
      status: "completed",
      requestHash,
      updatedAt: "2026-05-29T10:00:00.000Z",
      claimToken: "",
      expiresAt: "2026-05-30T10:00:00.000Z",
    };
    const executeQuery = vi.fn(
      async (query: string, params?: Record<string, string>) => {
        if (
          query.includes("DELETE FROM codex_idempotency_keys") &&
          query.includes("expires_at <")
        ) {
          return {};
        }
        if (query.includes("DELETE FROM codex_idempotency_keys")) {
          stored = null;
          return {};
        }
        if (query.includes("INSERT INTO codex_idempotency_keys")) {
          if (stored) throw new Error("duplicate primary key");
          insertedClaimToken = String(params?.$claim_token ?? "");
          stored = {
            status: "in_progress",
            requestHash,
            updatedAt: String(params?.$updated_at ?? ""),
            claimToken: insertedClaimToken,
            expiresAt: String(params?.$expires_at ?? ""),
          };
          return {};
        }
        return stored ? ydbRecord(stored) : emptyYdbRecord();
      },
    );
    vi.mocked(withSession).mockImplementation(async (callback) =>
      callback({ executeQuery } as never),
    );

    const claim = await claimIdempotencyKey({
      route: "POST /test",
      key: "expired-ydb-row",
      requestHash,
    });

    expect(claim).toEqual({
      kind: "fresh",
      claim: { claimToken: insertedClaimToken },
    });
  });

  it("does not delete a fresh claim after losing an expired-row delete race", async () => {
    vi.setSystemTime(new Date("2026-05-30T10:00:01.000Z"));
    const requestHash = hashIdempotencyPayload({ prompt: "same" });
    let stored: YdbRecordInput | null = {
      status: "completed",
      requestHash,
      updatedAt: "2026-05-29T10:00:00.000Z",
      claimToken: "",
      expiresAt: "2026-05-30T10:00:00.000Z",
    };
    const winner: YdbRecordInput = {
      status: "in_progress",
      requestHash,
      updatedAt: "2026-05-30T10:00:01.000Z",
      claimToken: "winner-token",
      expiresAt: "2026-05-31T10:00:01.000Z",
    };
    const executeQuery = vi.fn(
      async (query: string, params?: Record<string, string>) => {
        if (
          query.includes("DELETE FROM codex_idempotency_keys") &&
          query.includes("expires_at <")
        ) {
          return {};
        }
        if (query.includes("INSERT INTO codex_idempotency_keys")) {
          if (stored) throw new Error("duplicate primary key");
          stored = {
            status: "in_progress",
            requestHash,
            updatedAt: String(params?.$updated_at ?? ""),
            claimToken: String(params?.$claim_token ?? ""),
            expiresAt: String(params?.$expires_at ?? ""),
          };
          return {};
        }
        if (query.includes("DELETE FROM codex_idempotency_keys")) {
          stored = winner;
          const deleteMatchesWinner =
            query.includes("request_hash = $request_hash") &&
            params?.$status === winner.status &&
            params?.$request_hash === winner.requestHash &&
            params?.$updated_at === winner.updatedAt &&
            params?.$claim_token === winner.claimToken &&
            params?.$expires_at === winner.expiresAt;
          if (!query.includes("request_hash = $request_hash") || deleteMatchesWinner) {
            stored = null;
          }
          return {};
        }
        return stored ? ydbRecord(stored) : emptyYdbRecord();
      },
    );
    vi.mocked(withSession).mockImplementation(async (callback) =>
      callback({ executeQuery } as never),
    );

    const claim = await claimIdempotencyKey({
      route: "POST /test",
      key: "expired-delete-race",
      requestHash,
    });

    expect(claim.kind).toBe("in_progress");
    expect(stored?.claimToken).toBe("winner-token");
  });
});

type YdbRecordInput = {
  status: "in_progress" | "completed" | "committed";
  requestHash: string;
  updatedAt: string;
  claimToken: string;
  expiresAt?: string;
};

function ydbRecord(input: YdbRecordInput) {
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
              { textValue: input.expiresAt ?? "2026-05-30T10:10:01.000Z" },
            ],
          },
        ],
      },
    ],
  };
}

function emptyYdbRecord() {
  return { resultSets: [{ rows: [] }] };
}
