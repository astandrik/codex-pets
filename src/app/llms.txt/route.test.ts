import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: repositoryMocks.listApprovedPets,
}));

describe("GET /llms.txt public author email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("publishes only the moderator-approved author email", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.listApprovedPets.mockResolvedValueOnce([
      {
        slug: "boba",
        displayName: "Boba",
        kind: "creature",
        tags: ["round"],
        ownerName: "Creator",
        ownerProfileSlug: "creator",
        contactEmail: "private@example.com",
        publicAuthorEmail: "creator+public@example.com",
      },
    ]);

    const { GET } = await import("@/app/llms.txt/route");
    const response = await GET();
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Public email: creator+public@example.com");
    expect(body).not.toContain("private@example.com");
  });
});
