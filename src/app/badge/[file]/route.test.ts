import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getApprovedPetBySlug: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  getApprovedPetBySlug: repositoryMocks.getApprovedPetBySlug,
}));

const approvedPet = {
  id: "pet_1",
  slug: "orbit-otter",
  displayName: "Orbit Otter",
  description: "Demo pet",
  spritesheetUrl: "https://assets/pets/orbit.webp",
  petJsonUrl: "https://assets/pets/orbit.json",
  zipUrl: "https://assets/pets/orbit.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: ["space"],
  status: "approved" as const,
  ownerName: "Creator",
  contactEmail: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

describe("GET /badge/[file]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns a badge SVG for approved pets", async () => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const { GET } = await import("@/app/badge/[file]/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ file: "orbit-otter.svg" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "image/svg+xml; charset=utf-8",
    );
    expect(body).toContain("<svg");
    expect(body).toContain("Orbit Otter");
    expect(repositoryMocks.getApprovedPetBySlug).toHaveBeenCalledWith(
      "orbit-otter",
    );
  });

  it("returns 404 for non-svg files", async () => {
    const { GET } = await import("@/app/badge/[file]/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ file: "orbit-otter.png" }),
    });

    expect(response.status).toBe(404);
    expect(repositoryMocks.getApprovedPetBySlug).not.toHaveBeenCalled();
  });
});
