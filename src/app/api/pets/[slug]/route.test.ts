import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  getApprovedPetBySlug: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  getApprovedPetBySlug: repositoryMocks.getApprovedPetBySlug,
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

describe("GET /api/pets/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns approved pet JSON and advertises the TOON alternate", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const { GET } = await import("@/app/api/pets/[slug]/route");

    const response = await GET(new Request("https://pets.example/api/pets/boba"), {
      params: Promise.resolve({ slug: "boba" }),
    });
    const body = await response.json();

    expect(repositoryMocks.getApprovedPetBySlug).toHaveBeenCalledWith("boba");
    expect(response.status).toBe(200);
    expect(response.headers.get("Link")).toBe(
      '<https://pets.example/api/pets/boba.toon>; rel="alternate"; type="text/toon"',
    );
    expect(body).toEqual({ pet: approvedPet });
  });

  it("returns a TOON pet detail matching the JSON payload", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const { GET } = await import("@/app/api/pets/[slug]/route");
    const jsonResponse = await GET(new Request("https://pets.example/api/pets/boba"), {
      params: Promise.resolve({ slug: "boba" }),
    });
    const jsonBody = await jsonResponse.json();

    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(approvedPet);
    const toonResponse = await GET(
      new Request("https://pets.example/api/pets/boba.toon"),
      {
        params: Promise.resolve({ slug: "boba.toon" }),
      },
    );
    const toonBody = decode(await toonResponse.text());

    expect(repositoryMocks.getApprovedPetBySlug).toHaveBeenLastCalledWith("boba");
    expect(toonResponse.status).toBe(200);
    expect(toonResponse.headers.get("Content-Type")).toBe(
      "text/toon; charset=utf-8",
    );
    expect(toonResponse.headers.get("Link")).toBe(
      '<https://pets.example/api/pets/boba>; rel="alternate"; type="application/json"',
    );
    expect(toonBody).toEqual(jsonBody);
  });

  it("returns a TOON 404 for missing pet detail requests", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.getApprovedPetBySlug.mockResolvedValueOnce(null);
    const { GET } = await import("@/app/api/pets/[slug]/route");

    const response = await GET(
      new Request("https://pets.example/api/pets/missing.toon"),
      {
        params: Promise.resolve({ slug: "missing.toon" }),
      },
    );

    expect(repositoryMocks.getApprovedPetBySlug).toHaveBeenCalledWith("missing");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe(
      "text/toon; charset=utf-8",
    );
    expect(decode(await response.text())).toEqual({ error: "not_found" });
  });
});
