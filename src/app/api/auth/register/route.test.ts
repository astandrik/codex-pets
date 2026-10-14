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
import { createUser, createSessionForUser } from "@/lib/auth/repository";
import { EmailAlreadyExistsError } from "@/lib/auth/errors";
import { revalidateSitemapCache } from "@/lib/sitemap-cache";

describe("POST /api/auth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => vi.unstubAllEnvs());

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

  it("returns the existing 409 contract for an email conflict during creation", async () => {
    vi.stubEnv("AUTH_MODE", "app-session");
    vi.mocked(createUser).mockRejectedValueOnce(new EmailAlreadyExistsError());
    const response = await POST(registrationRequest());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "email_taken", message: "An account with this email already exists.",
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(createSessionForUser).not.toHaveBeenCalled();
    expect(revalidateSitemapCache).not.toHaveBeenCalled();
  });

  it("keeps unrelated creation failures distinct from an email conflict", async () => {
    vi.stubEnv("AUTH_MODE", "app-session");
    const failure = new Error("synthetic storage failure");
    vi.mocked(createUser).mockRejectedValueOnce(failure);
    await expect(POST(registrationRequest())).rejects.toBe(failure);
    expect(createSessionForUser).not.toHaveBeenCalled();
  });


  it.each([null, [], "invalid"])("rejects non-object JSON %j before account work", async (body) => {
    vi.stubEnv("AUTH_MODE", "app-session");
    vi.stubEnv("SESSION_COOKIE_SECRET", "synthetic-cookie-secret");
    const response = await POST(new Request("http://localhost/api/auth/register", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
    expect(createUser).not.toHaveBeenCalled();
    expect(createSessionForUser).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

});


function registrationRequest(): Request {
  return new Request("http://localhost/api/auth/register", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "user@example.com", password: "long-enough-password", displayName: "User" }),
  });
}
