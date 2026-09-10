import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const searchMocks = vi.hoisted(() => ({
  searchApprovedPets: vi.fn(),
}));
const repositoryMocks = vi.hoisted(() => ({
  listApprovedPetsForSearch: vi.fn(),
}));

vi.mock("@/lib/pets/search-runtime", () => ({
  searchApprovedPets: searchMocks.searchApprovedPets,
}));
vi.mock("@/lib/pets/repository", () => ({
  listApprovedPetsForSearch: repositoryMocks.listApprovedPetsForSearch,
}));
vi.mock("next/cache", () => ({
  unstable_cache: (callback: unknown) => callback,
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
  ownerProfileSlug: "creator",
  ownerAvatarUrl: "/api/users/avatars/avatar_123",
  contactEmail: "private@example.com",
  publicAuthorEmail: "creator+public@example.com",
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

const approvedPetPayload = {
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
  ownerProfileSlug: "creator",
  ownerProfileUrl: "https://pets.example/users/creator",
  ownerAvatarUrl: "https://pets.example/api/users/avatars/avatar_123",
  publicAuthorEmail: "creator+public@example.com",
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 0,
  installCount: 0,
  likeCount: 0,
};

const semanticPet = {
  ...approvedPet,
  id: "pet_2",
  slug: "velvet-luma",
  displayName: "Velvet Luma",
  description: "A gothic character with no literal query token.",
  captionJson: '{"internal":true}',
  captionText: "internal visual caption",
  sourceHash: "internal-source-hash",
};

describe("GET /api/pets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    repositoryMocks.listApprovedPetsForSearch.mockResolvedValue([approvedPet]);
  });

  it("returns approved pets as JSON and advertises the TOON alternate", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [approvedPet],
      total: 1,
      mode: "hybrid",
      fallbackReason: null,
      visualMode: "hybrid",
      visualFallbackReason: null,
      visualCandidateCount: 1,
      durationMs: 12,
    });
    const { GET } = await import("@/app/api/pets/route");

    const response = await GET(
      new Request(
        "https://pets.example/api/pets?q=space&kind=creature&tags=friendly,space",
      ),
    );
    const body = await response.json();

    expect(searchMocks.searchApprovedPets).toHaveBeenCalledWith({
      q: "space",
      kind: "creature",
      tags: ["friendly", "space"],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Link")).toBe(
      '<https://pets.example/api/pets.toon?q=space&kind=creature&tags=friendly,space>; rel="alternate"; type="text/toon"',
    );
    expect(body).toEqual({
      total: 1,
      pets: [approvedPetPayload],
    });
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(JSON.stringify(body)).toContain("creator+public@example.com");
  });

  it("adds pagination metadata only when page parameters are requested", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [approvedPet],
      total: 49,
      mode: "lexical",
      fallbackReason: null,
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 2,
    });
    const { GET } = await import("@/app/api/pets/route");

    const response = await GET(
      new Request("https://pets.example/api/pets?page=2&pageSize=24"),
    );

    expect(response.status).toBe(200);
    expect(searchMocks.searchApprovedPets).toHaveBeenCalledWith({
      q: "",
      kind: "all",
      tags: [],
      offset: 24,
      limit: 24,
    });
    expect(await response.json()).toEqual({
      total: 1,
      pets: [approvedPetPayload],
      pagination: {
        page: 2,
        pageSize: 24,
        totalItems: 49,
        totalPages: 3,
        hasNextPage: true,
      },
    });
  });

  it("rejects a continuation request from a different catalog snapshot", async () => {
    const { GET } = await import("@/app/api/pets/route");

    const response = await GET(
      new Request("https://pets.example/api/pets?page=2&pageSize=24", {
        headers: {
          "X-Codex-Pets-Catalog-Snapshot": "stale-snapshot",
        },
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "catalog_snapshot_changed",
      code: "catalog_snapshot_changed",
    });
    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
  });

  it("rejects a continuation request from a different ranked result", async () => {
    const { createApprovedPetsCatalogSnapshot } = await import(
      "@/lib/pets/catalog-snapshot-server"
    );
    const catalogVersion =
      createApprovedPetsCatalogSnapshot([approvedPet]).version;
    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [approvedPet],
      total: 1,
      mode: "lexical_fallback",
      fallbackReason: "timeout",
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 800,
      rankingVersion: "ranking-after-fallback",
    });
    const { GET } = await import("@/app/api/pets/route");

    const response = await GET(
      new Request(
        "https://pets.example/api/pets?q=space&page=2&pageSize=24",
        {
          headers: {
            "X-Codex-Pets-Catalog-Snapshot": catalogVersion,
            "X-Codex-Pets-Catalog-Ranking": "initial-hybrid-ranking",
          },
        },
      ),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "catalog_ranking_changed",
      code: "catalog_ranking_changed",
    });
  });

  it("returns an empty successful API page beyond the result set", async () => {
    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [],
      total: 49,
      mode: "lexical",
      fallbackReason: null,
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 2,
    });
    const { GET } = await import("@/app/api/pets/route");

    const response = await GET(
      new Request("https://pets.example/api/pets?page=4&pageSize=24"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      total: 0,
      pets: [],
      pagination: {
        page: 4,
        pageSize: 24,
        totalItems: 49,
        totalPages: 3,
        hasNextPage: false,
      },
    });
  });

  it.each([
    ["page", "0"],
    ["page", "1.5"],
    ["pageSize", "201"],
  ])("rejects invalid %s pagination values", async (field, value) => {
    const { GET } = await import("@/app/api/pets/route");

    const response = await GET(
      new Request(`https://pets.example/api/pets?${field}=${value}`),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_pagination",
      code: "invalid_pagination",
      field,
    });
    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
  });

  it("returns the same paginated payload as TOON", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const result = {
      pets: [approvedPet],
      total: 25,
      mode: "lexical",
      fallbackReason: null,
      visualMode: "off",
      visualFallbackReason: null,
      visualCandidateCount: 0,
      durationMs: 2,
    };
    searchMocks.searchApprovedPets.mockResolvedValueOnce(result);
    const { GET: getJson } = await import("@/app/api/pets/route");
    const jsonResponse = await getJson(
      new Request("https://pets.example/api/pets?page=1&pageSize=24"),
    );

    searchMocks.searchApprovedPets.mockResolvedValueOnce(result);
    const { GET: getToon } = await import("@/app/api/pets.toon/route");
    const toonResponse = await getToon(
      new Request("https://pets.example/api/pets.toon?page=1&pageSize=24"),
    );

    expect(decode(await toonResponse.text())).toEqual(
      await jsonResponse.json(),
    );
  });

  it("returns matching pagination validation errors as JSON and TOON", async () => {
    const { GET: getJson } = await import("@/app/api/pets/route");
    const jsonResponse = await getJson(
      new Request("https://pets.example/api/pets?pageSize=0"),
    );
    const { GET: getToon } = await import("@/app/api/pets.toon/route");
    const toonResponse = await getToon(
      new Request("https://pets.example/api/pets.toon?pageSize=0"),
    );

    expect(jsonResponse.status).toBe(400);
    expect(toonResponse.status).toBe(400);
    expect(decode(await toonResponse.text())).toEqual(
      await jsonResponse.json(),
    );
  });

  it("returns TOON search results matching the JSON payload", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    const request = new Request(
      "https://pets.example/api/pets?q=space&kind=creature&tags=friendly,space",
    );
    const toonRequest = new Request(
      "https://pets.example/api/pets.toon?q=space&kind=creature&tags=friendly,space",
    );

    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [semanticPet, approvedPet],
      total: 2,
      mode: "hybrid",
      fallbackReason: null,
      visualMode: "hybrid",
      visualFallbackReason: null,
      visualCandidateCount: 1,
      durationMs: 12,
    });
    const { GET: getJson } = await import("@/app/api/pets/route");
    const jsonResponse = await getJson(request);
    const jsonBody = await jsonResponse.json();

    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [semanticPet, approvedPet],
      total: 2,
      mode: "hybrid",
      fallbackReason: null,
      visualMode: "hybrid",
      visualFallbackReason: null,
      visualCandidateCount: 1,
      durationMs: 12,
    });
    const { GET: getToon } = await import("@/app/api/pets.toon/route");
    const toonResponse = await getToon(toonRequest);
    const toonBody = decode(await toonResponse.text());

    expect(toonResponse.status).toBe(200);
    expect(toonResponse.headers.get("Content-Type")).toBe(
      "text/toon; charset=utf-8",
    );
    expect(toonResponse.headers.get("Link")).toBe(
      '<https://pets.example/api/pets?q=space&kind=creature&tags=friendly,space>; rel="alternate"; type="application/json"',
    );
    expect(toonBody).toEqual(jsonBody);
    expect(jsonBody.pets.map((pet: { slug: string }) => pet.slug)).toEqual([
      "velvet-luma",
      "orbit-otter",
    ]);
    expect(JSON.stringify(jsonBody)).not.toMatch(
      /captionJson|captionText|sourceHash|visualMode|visualFallbackReason/,
    );
  });

  it.each(["timeout", "rate_limited", "provider_error"] as const)(
    "returns HTTP 200 lexical payloads for %s semantic fallbacks",
    async (fallbackReason) => {
      searchMocks.searchApprovedPets.mockResolvedValueOnce({
        pets: [approvedPet],
        total: 1,
        mode: "lexical_fallback",
        fallbackReason,
        visualMode: "off",
        visualFallbackReason: null,
        visualCandidateCount: 0,
        durationMs: 800,
      });
      const { GET } = await import("@/app/api/pets/route");

      const response = await GET(
        new Request("https://pets.example/api/pets?q=sexy"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pets).toHaveLength(1);
      expect(body).not.toHaveProperty("mode");
      expect(body).not.toHaveProperty("fallbackReason");
      expect(body).not.toHaveProperty("durationMs");
    },
  );

  it.each([
    "visual_vector_search_error",
    "visual_caption_lookup_error",
  ] as const)(
    "returns HTTP 200 text-hybrid payloads for %s visual fallbacks",
    async (visualFallbackReason) => {
      searchMocks.searchApprovedPets.mockResolvedValueOnce({
        pets: [semanticPet, approvedPet],
        total: 2,
        mode: "hybrid",
        fallbackReason: null,
        visualMode: "hybrid",
        visualFallbackReason,
        visualCandidateCount: 0,
        durationMs: 45,
      });
      const { GET } = await import("@/app/api/pets/route");

      const response = await GET(
        new Request("https://pets.example/api/pets?q=sexy"),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pets.map((pet: { slug: string }) => pet.slug)).toEqual([
        "velvet-luma",
        "orbit-otter",
      ]);
      expect(JSON.stringify(body)).not.toMatch(
        /caption|sourceHash|visualFallbackReason/,
      );
    },
  );
});
