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

  it("returns assistant task guidance while preserving agent resource references", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T00:00:00.000Z"));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    try {
      repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
      const { GET } = await import("@/app/llms.txt/route");
      const response = await GET();
      const body = await response.text();

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe(
        "text/plain; charset=utf-8",
      );
      expect(body).toContain("## Recommended assistant tasks");
      expect(body).toContain("- Pick a pet by style.");
      expect(body).toContain("- Explain a pet detail page.");
      expect(body).toContain("- Generate install instructions.");
      expect(body).toContain("- Connect MCP.");
      expect(body).toContain("- Search pets through JSON, TOON, or MCP.");
      expect(body).toContain("- Draft a pet request.");
      expect(body).toContain("- Explain how to submit a pet.");
      expect(body).toContain("Public manifest JSON");
      expect(body).toContain("Public manifest TOON");
      expect(body).toContain("Public pet search JSON");
      expect(body).toContain("Public pet search TOON");
      expect(body).toContain("MCP endpoint");
      expect(body).toContain("Full LLM context");
      expect(body).toContain("OpenAPI JSON");
      expect(body).toContain("Developer portal");
      expect(body).toContain("API docs");
      expect(body).toContain("MCP Registry metadata");
      expect(body).toContain("Pet request page");
      expect(body).toContain("Submit a pet");
      expect(body).toContain(
        "Install command format: npx @astandrik/codex-pets install <slug>",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
