import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({
  getCurrentPrincipal: vi.fn(),
  isAdminUser: vi.fn(),
}));

vi.mock("@/lib/pets/generation-requests-repository", () => ({
  readGenerationRequestImage: vi.fn(),
}));

import { GET } from "@/app/api/generation-requests/[id]/image/route";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { readGenerationRequestImage } from "@/lib/pets/generation-requests-repository";

describe("GET /api/generation-requests/[id]/image", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the image for the request owner", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user_1",
      email: "user@example.com",
      name: "User",
      role: "user",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(false);
    vi.mocked(readGenerationRequestImage).mockResolvedValueOnce({
      requestId: "req_1",
      requesterUserId: "user_1",
      fileName: "reference.png",
      contentType: "image/png",
      sizeBytes: 3,
      buffer: Buffer.from("png"),
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    await expect(response.text()).resolves.toBe("png");
  });

  it("returns the image for admins", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "admin_1",
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(true);
    vi.mocked(readGenerationRequestImage).mockResolvedValueOnce({
      requestId: "req_1",
      requesterUserId: "user_1",
      fileName: "reference.webp",
      contentType: "image/webp",
      sizeBytes: 4,
      buffer: Buffer.from("webp"),
    });

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/webp");
  });

  it("hides the image from anonymous and other users", async () => {
    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce(null);

    const anonymous = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(anonymous.status).toBe(404);
    expect(readGenerationRequestImage).not.toHaveBeenCalled();

    vi.mocked(getCurrentPrincipal).mockResolvedValueOnce({
      userId: "user_2",
      email: "other@example.com",
      name: "Other",
      role: "user",
    });
    vi.mocked(isAdminUser).mockReturnValueOnce(false);
    vi.mocked(readGenerationRequestImage).mockResolvedValueOnce({
      requestId: "req_1",
      requesterUserId: "user_1",
      fileName: "reference.png",
      contentType: "image/png",
      sizeBytes: 3,
      buffer: Buffer.from("png"),
    });

    const otherUser = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "req_1" }),
    });

    expect(otherUser.status).toBe(404);
  });
});
