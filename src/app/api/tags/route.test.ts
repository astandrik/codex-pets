import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: repositoryMocks.listApprovedPets,
}));

const basePet = {
  id: "pet_1",
  slug: "orbit-otter",
  displayName: "Orbit Otter",
  description: "Demo pet",
  spritesheetUrl: "https://assets/pets/orbit.webp",
  petJsonUrl: "https://assets/pets/orbit.json",
  zipUrl: "https://assets/pets/orbit.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: ["space", "friendly"],
  status: "approved" as const,
  ownerName: "Creator",
  contactEmail: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

describe("GET /api/tags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns tag counts for approved pets", async () => {
    repositoryMocks.listApprovedPets.mockResolvedValueOnce([
      basePet,
      {
        ...basePet,
        slug: "terminal-cube",
        tags: ["space", "terminal"],
      },
    ]);
    const { GET } = await import("@/app/api/tags/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(body).toEqual({
      generatedAt: expect.any(String),
      total: 3,
      tags: [
        { name: "space", count: 2 },
        { name: "friendly", count: 1 },
        { name: "terminal", count: 1 },
      ],
    });
  });
});
