import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: repositoryMocks.listApprovedPets,
}));

const approvedPet = {
  slug: "boba",
  displayName: "Boba",
  kind: "creature" as const,
  tags: ["round"],
  ownerName: "Creator",
  ownerProfileSlug: "creator",
};

describe("GET /llms-full.txt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns full agent documentation with API, auth, examples, and webhooks status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-26T00:00:00.000Z"));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);

    try {
      const { GET } = await import("@/app/llms-full.txt/route");
      const response = await GET();
      const body = await response.text();
      const nonEmptyLines = body
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(nonEmptyLines.length).toBeGreaterThanOrEqual(20);
      expect(body).toContain("## API reference");
      expect(body).toContain("[OpenAPI JSON](https://pets.example/openapi.json)");
      expect(body).toContain("## Authentication and access");
      expect(body).toContain("AppSessionCookie");
      expect(body).toContain("ProxyBasic");
      expect(body).toContain("## Quickstart examples");
      expect(body).toContain(
        "codex mcp add codexPets --url https://pets.example/mcp",
      );
      expect(body).toContain("curl -s https://pets.example/api/manifest");
      expect(body).toContain("## Webhooks");
      expect(body).toContain("Webhooks are not currently available");
      expect(body).toContain("[Boba](https://pets.example/pets/boba)");
      expect(body).toContain(
        "Pet v1 spritesheets use an 8x9 atlas at 1536x1872",
      );
      expect(body).toContain(
        "Pet v2 spritesheets set spriteVersionNumber to 2 and use an 8x11 atlas at 1536x2288",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
