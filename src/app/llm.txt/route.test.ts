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
};

describe("GET /llm.txt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns the same plain-text body as /llms.txt", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    try {
      repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
      const { GET: getLlms } = await import("@/app/llms.txt/route");
      const canonical = await getLlms();
      const canonicalBody = await canonical.text();

      repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
      const { GET: getLlm } = await import("@/app/llm.txt/route");
      const alias = await getLlm();
      const aliasBody = await alias.text();

      expect(alias.status).toBe(200);
      expect(alias.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
      expect(aliasBody).toBe(canonicalBody);
      expect(aliasBody).toContain("# Companion Gallery");
    } finally {
      vi.useRealTimers();
    }
  });
});
