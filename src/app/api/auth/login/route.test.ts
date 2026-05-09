import { describe, expect, it, vi } from "vitest";

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

describe("POST /api/auth/login", () => {
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
});
