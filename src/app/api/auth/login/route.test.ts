import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ydb/client", () => ({
  isYdbConfigured: vi.fn(() => true),
}));

vi.mock("@/lib/auth/repository", () => ({
  createSessionForUser: vi.fn(async () => ({
    sessionId: "session_1",
    userId: "user@example.com",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
  })),
  getRoleForEmail: vi.fn(() => "user"),
  getUserByEmail: vi.fn(async () => ({
    userId: "user@example.com",
    email: "user@example.com",
    emailLower: "user@example.com",
    passwordHash: "stored-hash",
    displayName: "User",
    role: "user",
    status: "active",
    emailVerifiedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  updateUserRole: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth/password", () => ({
  verifyPassword: vi.fn(async () => true),
}));

import { POST } from "@/app/api/auth/login/route";
import { createSessionForUser, getUserByEmail, updateUserRole } from "@/lib/auth/repository";
import { verifyPassword } from "@/lib/auth/password";

describe("POST /api/auth/login", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.unstubAllEnvs());
  it("logs in and returns a session cookie", async () => {
    vi.stubEnv("AUTH_MODE", "app-session");
    vi.stubEnv("SESSION_COOKIE_SECRET", "cookie-secret");

    const response = await POST(
      new Request("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "long-enough-password",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("codex_pets_session=");

    vi.unstubAllEnvs();
  });

  it.each(["wrong-password", "unknown-user", "disabled-user"] as const)(
    "does not issue a session for %s", async (condition) => {
      vi.stubEnv("AUTH_MODE", "app-session");
      if (condition === "wrong-password") vi.mocked(verifyPassword).mockResolvedValueOnce(false);
      if (condition === "unknown-user") vi.mocked(getUserByEmail).mockResolvedValueOnce(null);
      if (condition === "disabled-user") {
        const user = await getUserByEmail("user@example.com");
        if (!user) throw new Error("Expected synthetic fixture user");
        vi.mocked(getUserByEmail).mockResolvedValueOnce({ ...user, status: "disabled" });
      }
      const response = await POST(new Request("http://localhost/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@example.com", password: "long-enough-password" }),
      }));
      expect(response.status).toBe(condition === "disabled-user" ? 403 : 401);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(createSessionForUser).not.toHaveBeenCalled();
      expect(updateUserRole).not.toHaveBeenCalled();
    },
  );


  it.each([null, [], "invalid"])("rejects non-object JSON %j before account work", async (body) => {
    vi.stubEnv("AUTH_MODE", "app-session");
    vi.stubEnv("SESSION_COOKIE_SECRET", "synthetic-cookie-secret");
    const response = await POST(new Request("http://localhost/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
    expect(getUserByEmail).not.toHaveBeenCalled();
    expect(createSessionForUser).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

});
