import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmailAlreadyExistsError } from "@/lib/auth/errors";
import { createSessionForUser, createUser, deleteSessionById, getSessionById, updateUserProfile } from "@/lib/auth/repository";

const session = vi.hoisted(() => ({
  beginTransaction: vi.fn(), executeQuery: vi.fn(), commitTransaction: vi.fn(), rollbackTransaction: vi.fn(),
}));
vi.mock("@/lib/ydb/client", async (original) => ({
  ...await original<typeof import("@/lib/ydb/client")>(),
  withSession: (operation: (value: typeof session) => Promise<unknown>) => operation(session),
}));

const now = new Date("2026-10-14T12:00:00.000Z");
const userId = "synthetic@example.test";
const signup = { email: userId, passwordHash: "synthetic-hash", displayName: "Demo" };
const profile = { userId, displayName: "New name", profileSlug: "new-handle", bio: "New bio", websiteUrl: null, githubUrl: null, linkedinUrl: null };
const rows = (values: string[][]) => ({ resultSets: [{ rows: values.map((items) => ({ items: items.map((textValue) => ({ textValue })) })) }] });
const userRow = [userId, userId, userId, "synthetic-hash", "Demo", "old-handle", "", "", "", "", "", "user", "active", "", now.toISOString(), now.toISOString()];

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("INITIAL_ADMIN_EMAILS", "");
  vi.useFakeTimers();
  vi.setSystemTime(now);
  session.beginTransaction.mockResolvedValue({ id: "tx" });
  session.executeQuery.mockResolvedValue(rows([]));
  session.commitTransaction.mockResolvedValue(undefined);
  session.rollbackTransaction.mockResolvedValue(undefined);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("auth persistence contracts", () => {
  it("rejects duplicate email without retrying it as a profile-handle collision", async () => {
    session.executeQuery.mockResolvedValueOnce(rows([userRow]));
    await expect(createUser(signup)).rejects.toBeInstanceOf(EmailAlreadyExistsError);
    expect(session.beginTransaction).toHaveBeenCalledTimes(1);
    expect(session.executeQuery).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.rollbackTransaction).toHaveBeenCalledWith({ txId: "tx" });
  });

  it("retries a taken profile handle and commits the account with its reservation", async () => {
    session.executeQuery.mockResolvedValueOnce(rows([])).mockResolvedValueOnce(rows([["another-user"]]));
    const created = await createUser(signup);
    expect(created).toMatchObject({ userId, profileSlug: "demo-2", displayName: "Demo", role: "user" });
    expect(session.beginTransaction).toHaveBeenCalledTimes(2);
    expect(session.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    const writes = session.executeQuery.mock.calls.filter(([sql]) => sql.includes("UPSERT INTO"));
    expect(writes).toHaveLength(2);
    expect(writes[0][0]).toContain("codex_user_profile_slugs");
    expect(writes[1][0]).toContain("codex_users");
    for (const [, params, control] of writes) {
      expect(params.$user_id.value.textValue).toBe(userId);
      expect(params.$profile_slug.value.textValue).toBe("demo-2");
      expect(control).toEqual({ txId: "tx" });
    }
  });

  it.each([userId, "another-user"])("releases an old profile reservation only for its owner: %s", async (oldOwner) => {
    session.executeQuery.mockImplementation(async (sql, params) => {
      if (sql.includes("FROM codex_users") && sql.includes("WHERE user_id")) return rows([userRow]);
      if (sql.includes("SELECT user_id") && params.$profile_slug.value.textValue === "old-handle") return rows([[oldOwner]]);
      return rows([]);
    });
    await expect(updateUserProfile(profile)).resolves.toMatchObject({ ...profile, role: "user", updatedAt: now.toISOString() });
    const deletion = session.executeQuery.mock.calls.find(([sql]) => sql.includes("DELETE FROM codex_user_profile_slugs"));
    if (oldOwner === userId) {
      expect(deletion?.[1].$profile_slug.value.textValue).toBe("old-handle");
    } else {
      expect(deletion).toBeUndefined();
    }
    for (const call of session.executeQuery.mock.calls) expect(call[2]).toEqual({ txId: "tx" });
    expect(session.commitTransaction).toHaveBeenCalledWith({ txId: "tx" });
  });

  it("rolls back a failed profile write and retains the original error if rollback also fails", async () => {
    const failure = new Error("synthetic write failure");
    session.executeQuery.mockImplementation(async (sql) => {
      if (sql.includes("UPDATE codex_users")) throw failure;
      if (sql.includes("FROM codex_users") && sql.includes("WHERE user_id")) return rows([userRow]);
      return rows([]);
    });
    session.rollbackTransaction.mockRejectedValue(new Error("synthetic rollback failure"));
    await expect(updateUserProfile(profile)).rejects.toBe(failure);
    expect(session.commitTransaction).not.toHaveBeenCalled();
    expect(session.rollbackTransaction).toHaveBeenCalledWith({ txId: "tx" });
    expect(session.executeQuery.mock.calls.some(([sql]) => sql.includes("DELETE FROM"))).toBe(false);
  });

  it("propagates commit failure without returning an uncommitted account", async () => {
    const failure = new Error("synthetic commit failure");
    session.commitTransaction.mockRejectedValue(failure);
    await expect(createUser(signup)).rejects.toBe(failure);
    expect(session.beginTransaction).toHaveBeenCalledTimes(1);
    expect(session.rollbackTransaction).toHaveBeenCalledWith({ txId: "tx" });
  });

  it("does not query or roll back a transaction that failed to start", async () => {
    session.beginTransaction.mockResolvedValue({});
    await expect(createUser(signup)).rejects.toThrow("Unable to start YDB transaction.");
    expect(session.executeQuery).not.toHaveBeenCalled();
    expect(session.rollbackTransaction).not.toHaveBeenCalled();
  });

  it("writes and decodes the same session identity and expiry, then deletes only that session", async () => {
    const created = await createSessionForUser(userId);
    const [writeSql, params] = session.executeQuery.mock.calls[0];
    expect(writeSql).toContain("UPSERT INTO codex_sessions");
    expect(created.sessionId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(created.createdAt).toBe(now.toISOString());
    expect(Date.parse(created.expiresAt) - now.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
    expect(params.$session_id.value.textValue).toBe(created.sessionId);
    expect(params.$user_id.value.textValue).toBe(userId);
    expect(params.$expires_at.value.textValue).toBe(created.expiresAt);
    session.executeQuery.mockResolvedValueOnce(rows([[created.sessionId, userId, created.expiresAt, created.createdAt]]));
    await expect(getSessionById(created.sessionId)).resolves.toEqual(created);
    await deleteSessionById(created.sessionId);
    const [deleteSql, deleteParams] = session.executeQuery.mock.calls.at(-1)!;
    expect(deleteSql).toContain("DELETE FROM codex_sessions");
    expect(deleteSql).toContain("WHERE session_id = $session_id");
    expect(deleteParams.$session_id.value.textValue).toBe(created.sessionId);
    await expect(getSessionById(created.sessionId)).resolves.toBeNull();
  });
});
