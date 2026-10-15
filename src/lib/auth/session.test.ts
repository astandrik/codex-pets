import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "@/lib/auth/repository";

const mocks = vi.hoisted(() => ({
  cookie: vi.fn(), headers: vi.fn(), getSession: vi.fn(), getUser: vi.fn(), getRole: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.cookie }), headers: mocks.headers,
}));
vi.mock("@/lib/auth/repository", () => ({
  getSessionById: mocks.getSession, getUserById: mocks.getUser, getRoleForEmail: mocks.getRole,
}));

import { getCurrentPrincipal } from "@/lib/auth/session";
import { encodeSessionCookie, SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";

const currentUser: AuthUser = {
  userId: "user-1", email: "user@example.test", emailLower: "user@example.test",
  passwordHash: "synthetic", displayName: "User", profileSlug: "user",
  bio: null, websiteUrl: null, githubUrl: null, linkedinUrl: null, avatarId: null,
  role: "user", status: "active", emailVerifiedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
};

describe("current principal resolution", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-14T00:00:00.000Z"));
    vi.stubEnv("AUTH_MODE", "app-session");
    vi.stubEnv("SESSION_COOKIE_SECRET", "synthetic-cookie-secret");
    mocks.cookie.mockReturnValue({ name: SESSION_COOKIE_NAME, value: encodeSessionCookie("session-1") });
    mocks.getSession.mockResolvedValue({ sessionId: "session-1", userId: "user-1", expiresAt: "2026-10-14T00:01:00.000Z" });
    mocks.getUser.mockResolvedValue(currentUser);
    mocks.headers.mockResolvedValue(new Headers());
    mocks.getRole.mockReturnValue("user");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it.each(["absent", "tampered"])("rejects an %s session cookie before repository access", async (kind) => {
    mocks.cookie.mockReturnValue(kind === "absent" ? undefined : {
      value: encodeSessionCookie("session-1").replace("session-1", "session-2"),
    });
    await expect(getCurrentPrincipal()).resolves.toBeNull();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([null, { userId: "user-1", expiresAt: "2026-10-14T00:00:00.000Z" }])(
    "rejects missing or expired sessions", async (session) => {
      mocks.getSession.mockResolvedValue(session);
      await expect(getCurrentPrincipal()).resolves.toBeNull();
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );

  it.each([null, { ...currentUser, status: "disabled" }])("rejects missing or disabled users", async (user) => {
    mocks.getUser.mockResolvedValue(user);
    await expect(getCurrentPrincipal()).resolves.toBeNull();
  });

  it("resolves the active user behind a genuine signed session cookie", async () => {
    await expect(getCurrentPrincipal()).resolves.toEqual({
      userId: "user-1", email: "user@example.test", name: "User", profileSlug: "user", role: "user",
    });
    expect(mocks.getSession).toHaveBeenCalledWith("session-1");
    expect(mocks.getUser).toHaveBeenCalledWith("user-1");
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("does not resolve credentials in disabled mode", async () => {
    vi.stubEnv("AUTH_MODE", "disabled");
    await expect(getCurrentPrincipal()).resolves.toBeNull();
    expect(mocks.cookie).not.toHaveBeenCalled();
    expect(mocks.headers).not.toHaveBeenCalled();
  });

  it("uses explicit single-user configuration without repository access", async () => {
    vi.stubEnv("AUTH_MODE", "single-user");
    vi.stubEnv("AUTH_SINGLE_USER_ID", "local-user");
    vi.stubEnv("AUTH_SINGLE_USER_EMAIL", "local@example.test");
    vi.stubEnv("AUTH_SINGLE_USER_NAME", "Local");
    await expect(getCurrentPrincipal()).resolves.toEqual({
      userId: "local-user", email: "local@example.test", name: "Local", profileSlug: null, role: "admin",
    });
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("requires proxy identity before trusting its email or resolving a role", async () => {
    vi.stubEnv("AUTH_MODE", "proxy-basic");
    mocks.headers.mockResolvedValue(new Headers({ "x-remote-email": "staff@example.test" }));
    await expect(getCurrentPrincipal()).resolves.toBeNull();
    expect(mocks.getRole).not.toHaveBeenCalled();
  });

  it("resolves the established proxy identity through its current role policy", async () => {
    vi.stubEnv("AUTH_MODE", "proxy-basic");
    mocks.headers.mockResolvedValue(new Headers({
      "x-remote-user": "staff", "x-remote-email": "STAFF@example.test", "x-remote-name": "Staff",
    }));
    mocks.getRole.mockReturnValue("admin");
    await expect(getCurrentPrincipal()).resolves.toMatchObject({ userId: "staff", name: "Staff", role: "admin" });
    expect(mocks.getRole).toHaveBeenCalledWith("staff@example.test");
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("falls back to app-session for an unknown mode rather than trusting proxy headers", async () => {
    vi.stubEnv("AUTH_MODE", "unknown");
    mocks.cookie.mockReturnValue(undefined);
    mocks.headers.mockResolvedValue(new Headers({ "x-remote-user": "staff" }));
    await expect(getCurrentPrincipal()).resolves.toBeNull();
    expect(mocks.headers).not.toHaveBeenCalled();
  });
});
