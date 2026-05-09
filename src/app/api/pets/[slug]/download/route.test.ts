import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getApprovedPetBySlug: vi.fn(),
  incrementDownload: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  getApprovedPetBySlug: repositoryMocks.getApprovedPetBySlug,
  incrementDownload: repositoryMocks.incrementDownload,
}));

const approvedPet = {
  id: "pet_1",
  slug: "boba",
  displayName: "Boba",
  description: "desc",
  spritesheetUrl: "https://assets/pets/boba.webp",
  petJsonUrl: "https://assets/pets/boba.json",
  zipUrl: "https://assets/pets/boba.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: [],
  status: "approved" as const,
  ownerName: "user",
  contactEmail: null,
  createdAt: new Date().toISOString(),
  approvedAt: new Date().toISOString(),
  downloadCount: 0,
  likeCount: 0,
};

describe("GET /api/pets/[slug]/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns 404 for missing pets", async () => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/pets/[slug]/download/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
  });

  it("redirects to the zip and increments metrics", async () => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const { GET } = await import("@/app/api/pets/[slug]/download/route");

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ slug: "boba" }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://assets/pets/boba.zip");
    expect(repositoryMocks.incrementDownload).toHaveBeenCalledWith("boba");
  });

  it("redirects relative zip urls against the configured public app url", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://ydb-qdrant.tech/codex-pets");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/codex-pets");
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce({
      ...approvedPet,
      zipUrl: "/codex-pets/api/assets/a/pet.zip",
    });
    const { GET } = await import("@/app/api/pets/[slug]/download/route");

    const response = await GET(
      new Request("https://localhost:3000/codex-pets/api/pets/boba/download"),
      {
        params: Promise.resolve({ slug: "boba" }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://ydb-qdrant.tech/codex-pets/api/assets/a/pet.zip",
    );
    expect(repositoryMocks.incrementDownload).toHaveBeenCalledWith("boba");
  });
});
