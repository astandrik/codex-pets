import { beforeEach, describe, expect, it, vi } from "vitest";

const avatarMocks = vi.hoisted(() => ({
  readUserAvatar: vi.fn(),
}));

vi.mock("@/lib/auth/avatar-repository", () => ({
  readUserAvatar: avatarMocks.readUserAvatar,
}));

import { GET } from "@/app/api/users/avatars/[avatarId]/route";

describe("GET /api/users/avatars/[avatarId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a stored WebP avatar", async () => {
    avatarMocks.readUserAvatar.mockResolvedValueOnce({
      avatarId: "avatar_123",
      userId: "user@example.com",
      contentType: "image/webp",
      sizeBytes: 4,
      buffer: Buffer.from([1, 2, 3, 4]),
      createdAt: "2026-05-01T00:00:00.000Z",
      updatedAt: "2026-05-01T00:00:00.000Z",
    });

    const response = await GET(new Request("http://localhost/avatar"), {
      params: Promise.resolve({ avatarId: "avatar_123" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
  });

  it("returns 404 for a missing avatar", async () => {
    avatarMocks.readUserAvatar.mockResolvedValueOnce(null);

    const response = await GET(new Request("http://localhost/avatar"), {
      params: Promise.resolve({ avatarId: "missing" }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "avatar_not_found" });
  });
});
