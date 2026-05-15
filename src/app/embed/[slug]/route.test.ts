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
  displayName: "Orbit <Otter>",
  description: "A compact space helper.",
  spritesheetUrl: "/api/assets/a/spritesheet.webp",
  petJsonUrl: "/api/assets/a/pet.json",
  zipUrl: "/api/assets/a/pet.zip",
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

describe("GET /embed/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns minimal embed HTML for approved pets", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const { GET } = await import("@/app/embed/[slug]/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ slug: "orbit-otter" }),
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(body).toContain("Orbit &lt;Otter&gt;");
    expect(body).toContain(
      'src="https://pets.example/api/assets/a/idle-strip.webp"',
    );
    expect(body).toContain(
      'href="https://pets.example/pets/orbit-otter"',
    );
  });

  it("rejects invalid slugs", async () => {
    const { GET } = await import("@/app/embed/[slug]/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ slug: "../admin" }),
    });

    expect(response.status).toBe(400);
    expect(repositoryMocks.getApprovedPetBySlug).not.toHaveBeenCalled();
  });
});
