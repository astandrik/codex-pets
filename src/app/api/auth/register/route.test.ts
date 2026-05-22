import { beforeEach, describe, expect, it, vi } from "vitest";

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
  createUser: vi.fn(async () => ({
    userId: "user@example.com",
    email: "user@example.com",
    emailLower: "user@example.com",
    passwordHash: "hash",
    displayName: "User",
    role: "user",
    status: "active",
    emailVerifiedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })),
  getUserByEmail: vi.fn(async () => null),
  normalizeEmail: vi.fn((value: string) => ({
    email: value.trim(),
    emailLower: value.trim().toLowerCase(),
  })),
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn(async () => "hashed-password"),
  validatePasswordStrength: vi.fn(() => null),
}));

vi.mock("@/lib/sitemap-cache", () => ({
  revalidateSitemapCache: vi.fn(),
}));

import { POST } from "@/app/api/auth/register/route";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not revalidate sitemap cache for invalid JSON", async () => {
    vi.stubEnv("AUTH_MODE", "app-session");

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(revalidateSitemapCache).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
  });

  it("creates an account and returns a session cookie", async () => {
    vi.stubEnv("AUTH_MODE", "app-session");
    vi.stubEnv("SESSION_COOKIE_SECRET", "cookie-secret");
    vi.stubEnv("PASSWORD_PEPPER", "pepper");

    const response = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "user@example.com",
          password: "long-enough-password",
          displayName: "User",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("codex_pets_session=");
    expect(revalidateSitemapCache).toHaveBeenCalledTimes(1);

    vi.unstubAllEnvs();
  });
});
