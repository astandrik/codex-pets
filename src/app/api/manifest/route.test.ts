import { beforeEach, describe, expect, it, vi } from "vitest";
import { decode } from "@toon-format/toon";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: repositoryMocks.listApprovedPets,
}));

const approvedPet = {
  id: "pet_1",
  slug: "boba",
  displayName: "Boba",
  description: "Demo pet",
  spritesheetUrl: "https://assets/pets/boba.webp",
  petJsonUrl: "https://assets/pets/boba.json",
  zipUrl: "https://assets/pets/boba.zip",
  spritesheetExt: "webp" as const,
  kind: "creature" as const,
  tags: ["round"],
  status: "approved" as const,
  ownerName: "Creator",
  contactEmail: null,
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

describe("GET /api/manifest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns an agent-friendly manifest for approved pets", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");
    repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
    const { GET } = await import("@/app/api/manifest/route");

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(body).toEqual({
      generatedAt: expect.any(String),
      total: 1,
      pets: [
        {
          slug: "boba",
          displayName: "Boba",
          description: "Demo pet",
          kind: "creature",
          tags: ["round"],
          submittedBy: "Creator",
          pageUrl: "https://pets.example/pets/boba",
          spritesheetUrl: "https://assets/pets/boba.webp",
          petJsonUrl: "https://assets/pets/boba.json",
          zipUrl: "https://assets/pets/boba.zip",
          installCommand: "npx @astandrik/codex-pets install boba",
          createdAt: "2026-05-01T00:00:00.000Z",
          approvedAt: "2026-05-02T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns a TOON manifest matching the JSON payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    try {
      repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
      const { GET: getJson } = await import("@/app/api/manifest/route");
      const jsonResponse = await getJson();
      const jsonBody = await jsonResponse.json();

      repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
      const { GET: getToon } = await import("@/app/api/manifest.toon/route");
      const toonResponse = await getToon();
      const toonBody = decode(await toonResponse.text());

      expect(toonResponse.status).toBe(200);
      expect(toonResponse.headers.get("Content-Type")).toBe(
        "text/toon; charset=utf-8",
      );
      expect(toonResponse.headers.get("Link")).toBe(
        '<https://pets.example/api/manifest>; rel="alternate"; type="application/json"',
      );
      expect(toonBody).toEqual(jsonBody);
    } finally {
      vi.useRealTimers();
    }
  });
});
