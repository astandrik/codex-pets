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
      "background-image:url('https://pets.example/api/assets/a/spritesheet.webp')",
    );
    expect(body).toContain(
      'href="https://pets.example/pets/orbit-otter"',
    );
    expect(body).toContain("Creator");
    expect(body).toContain("space");
  });

  it("applies safe embed query options", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const { GET } = await import("@/app/embed/[slug]/route");

    const response = await GET(
      new Request(
        "https://pets.example/embed/orbit-otter?theme=dark&state=review&compact=true&showInstall=false&showAuthor=false&showTags=false",
      ),
      {
        params: Promise.resolve({ slug: "orbit-otter" }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('<html lang="en" class="theme-dark">');
    expect(body).toContain('class="embed-card embed-card--compact"');
    expect(body).toContain("--pet-row-y:-3328px");
    expect(body).toContain("--pet-frames:6");
    expect(body).not.toContain("Creator");
    expect(body).not.toContain('<p class="embed-card__tags">');
    expect(body).not.toContain('<a class="embed-card__install"');
  });

  it("renders sprite-only mode with scale and state params", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const { GET } = await import("@/app/embed/[slug]/route");

    const response = await GET(
      new Request(
        "https://pets.example/embed/orbit-otter?mode=sprite&state=running&scale=2&theme=dark",
      ),
      {
        params: Promise.resolve({ slug: "orbit-otter" }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('class="embed-sprite"');
    expect(body).toContain("width:384px");
    expect(body).toContain("height:416px");
    expect(body).toContain("--pet-row-y:-2912px");
    expect(body).toContain("--pet-end-x:-2304px");
    expect(body).not.toContain("View in registry");
    expect(body).not.toContain("<h1>");
    expect(body).not.toContain('class="embed-card__meta"');
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
