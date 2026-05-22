import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getCurrentPrincipal: vi.fn(),
}));

const repositoryMocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
}));

const avatarMocks = vi.hoisted(() => ({
  clearUserAvatar: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: authMocks.getCurrentPrincipal,
}));

vi.mock("@/lib/auth/repository", () => ({
  getUserById: repositoryMocks.getUserById,
}));

vi.mock("@/lib/auth/avatar-repository", () => ({
  clearUserAvatar: avatarMocks.clearUserAvatar,
}));

vi.mock("@/lib/ydb/client", () => ({
  isYdbConfigured: vi.fn(() => true),
}));

import { DELETE } from "@/app/api/auth/profile/avatar/route";

describe("DELETE /api/auth/profile/avatar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a signed-in local profile", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce(null);

    const response = await DELETE();

    expect(response.status).toBe(401);
    expect(avatarMocks.clearUserAvatar).not.toHaveBeenCalled();
  });

  it("clears the current user's avatar", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce({
      userId: "user@example.com",
    });

    const response = await DELETE();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(avatarMocks.clearUserAvatar).toHaveBeenCalledWith("user@example.com");
    expect(body).toEqual({
      ok: true,
      profile: {
        avatarUrl: null,
      },
    });
  });
});
