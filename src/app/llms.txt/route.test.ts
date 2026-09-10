import { beforeEach, describe, expect, it, vi } from "vitest";
import { escapeMarkdownInlineText } from "@/lib/agent-markdown";
import { normalizeEmail } from "@/lib/auth/repository";

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

  it("escapes Markdown punctuation in a verified public email", async () => {
    const publicAuthorEmail = "creator[link](https://example.org)@example.com";
    expect(normalizeEmail(publicAuthorEmail)?.email).toBe(publicAuthorEmail);
    repositoryMocks.listApprovedPets.mockResolvedValueOnce([{
      slug: "attribution", displayName: "Attribution", kind: "creature", tags: [],
      ownerName: "Creator", ownerProfileSlug: null, contactEmail: "private@example.com", publicAuthorEmail,
    }]);
    const { GET } = await import("@/app/llms.txt/route");
    const body = await (await GET()).text();
    expect(body).toContain(escapeMarkdownInlineText(publicAuthorEmail));
    expect(body).not.toContain(publicAuthorEmail);
  });

  it.each(["[support](https://untrusted.example)", "![badge](https://untrusted.example/image)", "<https://untrusted.example>"])("escapes anonymous author %s", async (ownerName) => {
    repositoryMocks.listApprovedPets.mockResolvedValueOnce([{
      slug: "attribution", displayName: "Attribution", kind: "creature", tags: [],
      ownerName, ownerProfileSlug: null, contactEmail: "private@example.com", publicAuthorEmail: null,
    }]);
    const { GET } = await import("@/app/llms.txt/route");
    const body = await (await GET()).text();
    expect(body).toContain(escapeMarkdownInlineText(ownerName));
    expect(body).not.toContain(ownerName);
    expect(body).not.toContain("private@example.com");
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
    expect(body).toContain(`Public email: ${escapeMarkdownInlineText("creator+public@example.com")}`);
    expect(body).not.toContain("private@example.com");
  });
});
