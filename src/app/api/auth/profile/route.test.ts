import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

const authMocks = vi.hoisted(() => ({
  getCurrentPrincipal: vi.fn(),
}));

const repositoryMocks = vi.hoisted(() => ({
  getUserById: vi.fn(),
  normalizeProfileSlug: vi.fn((value: string) =>
    value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"),
  ),
  updateUserProfile: vi.fn(),
}));

const avatarMocks = vi.hoisted(() => ({
  storeUserAvatar: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: authMocks.getCurrentPrincipal,
}));

vi.mock("@/lib/auth/repository", () => ({
  getUserById: repositoryMocks.getUserById,
  normalizeProfileSlug: repositoryMocks.normalizeProfileSlug,
  updateUserProfile: repositoryMocks.updateUserProfile,
}));

vi.mock("@/lib/auth/avatar-repository", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/auth/avatar-repository")>();
  return {
    ...actual,
    storeUserAvatar: avatarMocks.storeUserAvatar,
  };
});

vi.mock("@/lib/ydb/client", () => ({
  isYdbConfigured: vi.fn(() => true),
}));

import { PATCH } from "@/app/api/auth/profile/route";

describe("PATCH /api/auth/profile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires a signed-in local profile", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce(null);

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        body: JSON.stringify({ displayName: "User" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("updates public profile fields for the current user", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      emailLower: "user@example.com",
      passwordHash: "hash",
      displayName: "User",
      profileSlug: "user",
      bio: null,
      websiteUrl: null,
      githubUrl: null,
      linkedinUrl: null,
      avatarId: null,
      role: "user",
      status: "active",
      emailVerifiedAt: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    repositoryMocks.updateUserProfile.mockResolvedValueOnce({
      displayName: "New User",
      profileSlug: "new-user",
      bio: "Makes pets.",
      websiteUrl: "https://example.com/",
      githubUrl: "https://github.com/example",
      linkedinUrl: "https://www.linkedin.com/in/example",
      avatarId: null,
    });

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: " New User ",
          profileSlug: "New User",
          bio: " Makes pets. ",
          websiteUrl: "https://example.com",
          githubUrl: "https://github.com/example",
          linkedinUrl: "https://www.linkedin.com/in/example",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repositoryMocks.updateUserProfile).toHaveBeenCalledWith({
      userId: "user@example.com",
      displayName: "New User",
      profileSlug: "new-user",
      bio: "Makes pets.",
      websiteUrl: "https://example.com/",
      githubUrl: "https://github.com/example",
      linkedinUrl: "https://www.linkedin.com/in/example",
    });
    expect(body).toEqual({
      ok: true,
      profile: {
        displayName: "New User",
        profileSlug: "new-user",
        bio: "Makes pets.",
        websiteUrl: "https://example.com/",
        githubUrl: "https://github.com/example",
        linkedinUrl: "https://www.linkedin.com/in/example",
        avatarUrl: null,
      },
    });
  });

  it("rejects a GitHub URL on a different host", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce(createExistingUser());

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "User",
          profileSlug: "user",
          githubUrl: "https://gitlab.com/example",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "invalid_github_url" });
    expect(repositoryMocks.updateUserProfile).not.toHaveBeenCalled();
  });

  it("rejects a LinkedIn URL on a different host", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce(createExistingUser());

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "User",
          profileSlug: "user",
          linkedinUrl: "https://example.com/in/user",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "invalid_linkedin_url" });
    expect(repositoryMocks.updateUserProfile).not.toHaveBeenCalled();
  });

  it("normalizes empty social fields to null", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce(createExistingUser());
    repositoryMocks.updateUserProfile.mockResolvedValueOnce({
      displayName: "User",
      profileSlug: "user",
      bio: null,
      websiteUrl: null,
      githubUrl: null,
      linkedinUrl: null,
      avatarId: null,
    });

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "User",
          profileSlug: "user",
          websiteUrl: "",
          githubUrl: " ",
          linkedinUrl: "",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(repositoryMocks.updateUserProfile).toHaveBeenCalledWith({
      userId: "user@example.com",
      displayName: "User",
      profileSlug: "user",
      bio: null,
      websiteUrl: null,
      githubUrl: null,
      linkedinUrl: null,
    });
  });

  it("updates profile fields and stores an uploaded avatar from multipart form data", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce(createExistingUser());
    repositoryMocks.updateUserProfile.mockResolvedValueOnce({
      ...createExistingUser(),
      displayName: "Avatar User",
      profileSlug: "avatar-user",
      bio: "Has a face.",
    });
    avatarMocks.storeUserAvatar.mockResolvedValueOnce({
      avatarId: "avatar_123",
      avatarUrl: "/api/users/avatars/avatar_123",
    });

    const form = createProfileFormData({
      displayName: "Avatar User",
      profileSlug: "avatar-user",
      bio: "Has a face.",
      avatar: new File([await validPng()], "avatar.png", { type: "image/png" }),
    });

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        body: form,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(repositoryMocks.updateUserProfile).toHaveBeenCalledWith({
      userId: "user@example.com",
      displayName: "Avatar User",
      profileSlug: "avatar-user",
      bio: "Has a face.",
      websiteUrl: null,
      githubUrl: null,
      linkedinUrl: null,
    });
    expect(avatarMocks.storeUserAvatar).toHaveBeenCalledWith({
      userId: "user@example.com",
      buffer: expect.any(Buffer),
      sizeBytes: expect.any(Number),
    });
    expect(body.profile.avatarUrl).toBe("/api/users/avatars/avatar_123");
  });

  it("rejects an avatar with an unsupported file type", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce(createExistingUser());

    const form = createProfileFormData({
      displayName: "User",
      profileSlug: "user",
      avatar: new File(["plain text"], "avatar.txt", { type: "text/plain" }),
    });

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        body: form,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "invalid_avatar_type" });
    expect(repositoryMocks.updateUserProfile).not.toHaveBeenCalled();
    expect(avatarMocks.storeUserAvatar).not.toHaveBeenCalled();
  });

  it("rejects an avatar larger than 5 MB", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce(createExistingUser());

    const form = createProfileFormData({
      displayName: "User",
      profileSlug: "user",
      avatar: new File(
        [new Uint8Array(5 * 1024 * 1024 + 1)],
        "avatar.png",
        { type: "image/png" },
      ),
    });

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        body: form,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "avatar_too_large" });
    expect(repositoryMocks.updateUserProfile).not.toHaveBeenCalled();
    expect(avatarMocks.storeUserAvatar).not.toHaveBeenCalled();
  });

  it("rejects a broken avatar image", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce(createExistingUser());

    const form = createProfileFormData({
      displayName: "User",
      profileSlug: "user",
      avatar: new File(["not an image"], "avatar.png", { type: "image/png" }),
    });

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        body: form,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ error: "invalid_avatar_image" });
    expect(repositoryMocks.updateUserProfile).not.toHaveBeenCalled();
    expect(avatarMocks.storeUserAvatar).not.toHaveBeenCalled();
  });

  it("returns a conflict for a taken handle", async () => {
    authMocks.getCurrentPrincipal.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      name: "User",
      profileSlug: "user",
      role: "user",
    });
    repositoryMocks.getUserById.mockResolvedValueOnce({
      userId: "user@example.com",
      email: "user@example.com",
      emailLower: "user@example.com",
      passwordHash: "hash",
      displayName: "User",
      profileSlug: "user",
      bio: null,
      websiteUrl: null,
      githubUrl: null,
      linkedinUrl: null,
      avatarId: null,
      role: "user",
      status: "active",
      emailVerifiedAt: null,
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });
    repositoryMocks.updateUserProfile.mockRejectedValueOnce(
      new Error("profile_slug_taken"),
    );

    const response = await PATCH(
      new Request("http://localhost/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: "User",
          profileSlug: "taken",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      error: "profile_slug_taken",
    });
  });
});

function createExistingUser() {
  return {
    userId: "user@example.com",
    email: "user@example.com",
    emailLower: "user@example.com",
    passwordHash: "hash",
    displayName: "User",
    profileSlug: "user",
    bio: null,
    websiteUrl: null,
    githubUrl: null,
    linkedinUrl: null,
    avatarId: null,
    role: "user",
    status: "active",
    emailVerifiedAt: null,
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  };
}

function createProfileFormData(input: {
  displayName: string;
  profileSlug: string;
  bio?: string;
  websiteUrl?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  avatar: File;
}): FormData {
  const form = new FormData();
  form.set("displayName", input.displayName);
  form.set("profileSlug", input.profileSlug);
  form.set("bio", input.bio ?? "");
  form.set("websiteUrl", input.websiteUrl ?? "");
  form.set("githubUrl", input.githubUrl ?? "");
  form.set("linkedinUrl", input.linkedinUrl ?? "");
  form.set("avatar", input.avatar);
  return form;
}

async function validPng(): Promise<ArrayBuffer> {
  const buffer = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 4,
      background: "#ffcc55",
    },
  })
    .png()
    .toBuffer();
  const arrayBuffer = new ArrayBuffer(buffer.byteLength);
  new Uint8Array(arrayBuffer).set(buffer);
  return arrayBuffer;
}
