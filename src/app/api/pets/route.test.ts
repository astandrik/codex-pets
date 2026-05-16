import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const repositoryMocks = vi.hoisted(() => ({
  listApprovedPets: vi.fn(),
}));

vi.mock("@/lib/pets/repository", () => ({
  listApprovedPets: repositoryMocks.listApprovedPets,
}));

const approvedPet = {
  id: "pet_1",
  slug: "orbit-otter",
  displayName: "Orbit Otter",
  description: "Demo pet",
  spritesheetUrl: "https://assets/pets/orbit.webp",
  petJsonUrl: "https://assets/pets/orbit.json",
  zipUrl: "https://assets/pets/orbit.zip",
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

describe("GET /api/pets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("returns approved pets as JSON and advertises the TOON alternate", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
    const { GET } = await import("@/app/api/pets/route");

    const response = await GET(
      new Request("https://pets.example/api/pets?q=space&kind=creature"),
    );
    const body = await response.json();

    expect(repositoryMocks.listApprovedPets).toHaveBeenCalledWith({
      q: "space",
      kind: "creature",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Link")).toBe(
      '<https://pets.example/api/pets.toon?q=space&kind=creature>; rel="alternate"; type="text/toon"',
    );
    expect(body).toEqual({
      total: 1,
      pets: [approvedPet],
    });
  });

  it("returns TOON search results matching the JSON payload", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const request = new Request(
      "https://pets.example/api/pets?q=space&kind=creature",
    );
    const toonRequest = new Request(
      "https://pets.example/api/pets.toon?q=space&kind=creature",
    );

    repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
    const { GET: getJson } = await import("@/app/api/pets/route");
    const jsonResponse = await getJson(request);
    const jsonBody = await jsonResponse.json();

    repositoryMocks.listApprovedPets.mockResolvedValueOnce([approvedPet]);
    const { GET: getToon } = await import("@/app/api/pets.toon/route");
    const toonResponse = await getToon(toonRequest);
    const toonBody = decode(await toonResponse.text());

    expect(toonResponse.status).toBe(200);
    expect(toonResponse.headers.get("Content-Type")).toBe(
      "text/toon; charset=utf-8",
    );
    expect(toonResponse.headers.get("Link")).toBe(
      '<https://pets.example/api/pets?q=space&kind=creature>; rel="alternate"; type="application/json"',
    );
    expect(toonBody).toEqual(jsonBody);
  });
});
