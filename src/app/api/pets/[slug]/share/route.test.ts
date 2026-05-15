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
  spritesheetUrl: "/api/assets/a/spritesheet.webp",
  petJsonUrl: "/api/assets/a/pet.json",
  zipUrl: "/api/assets/a/pet.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: ["space"],
  status: "approved" as const,
  ownerName: "Creator",
  contactEmail: "private@example.com",
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 7,
  installCount: 3,
  likeCount: 1,
};

describe("GET /api/pets/[slug]/share", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns share snippets for approved pets without private fields", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const { GET } = await import("@/app/api/pets/[slug]/share/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ slug: "orbit-otter" }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.pet.pageUrl).toBe("https://pets.example/pets/orbit-otter");
    expect(body.share.badge.markdown).toContain(
      "https://pets.example/badge/orbit-otter.svg",
    );
    expect(body.share.card.markdown).toContain(
      "https://pets.example/card/orbit-otter.gif?mode=sprite&scale=2&state=idle",
    );
    expect(body.share.embed.iframe).toContain(
      'src="https://pets.example/embed/orbit-otter?mode=sprite&amp;scale=2&amp;state=idle"',
    );
    expect(body.share.install.command).toBe(
      "npx @astandrik/codex-pets install orbit-otter",
    );
    expect(body.markdownBadge).toBe(body.share.badge.markdown);
    expect(body.markdownCard).toBe(body.share.card.markdown);
    expect(body.iframe).toBe(body.share.embed.iframe);
    expect(body.installCommand).toBe(
      "npx @astandrik/codex-pets install orbit-otter",
    );
    expect(body.installPrompt).toBe(
      "Install the Orbit Otter Codex pet from https://pets.example/pets/orbit-otter",
    );
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(JSON.stringify(body)).not.toContain("downloadCount");
  });

  it("rejects invalid slugs before repository lookup", async () => {
    const { GET } = await import("@/app/api/pets/[slug]/share/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ slug: "../admin" }),
    });

    await expect(response.json()).resolves.toEqual({ error: "invalid_slug" });
    expect(response.status).toBe(400);
    expect(repositoryMocks.getApprovedPetBySlug).not.toHaveBeenCalled();
  });

  it("returns 404 for missing pets", async () => {
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/pets/[slug]/share/route");

    const response = await GET(new Request("https://pets.example"), {
      params: Promise.resolve({ slug: "missing" }),
    });

    expect(response.status).toBe(404);
  });
});
