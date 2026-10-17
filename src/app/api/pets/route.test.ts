import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPetSearchService } from "@/lib/pets/search/search-service";

const searchMocks = vi.hoisted(() => ({
  searchApprovedPets: vi.fn(),
}));
const repositoryMocks = vi.hoisted(() => ({
  listApprovedPetsForSearch: vi.fn(),
}));

vi.mock("@/lib/pets/search/search-runtime", () => ({
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
    searchMocks.searchApprovedPets.mockResolvedValue({ pets: [], total: 0 });
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
      offset: 0,
      limit: 200,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Link")).toBe(
      '<https://pets.example/api/pets.toon?q=space&kind=creature&tags=friendly,space>; rel="alternate"; type="text/toon"',
    );
    expect(body).toEqual({
      total: 1,
      pets: [approvedPetPayload],
      pagination: {
        page: 1,
        pageSize: 200,
        totalItems: 1,
        totalPages: 1,
        hasNextPage: false,
      },
    });
    expect(JSON.stringify(body)).not.toContain("private@example.com");
    expect(JSON.stringify(body)).toContain("creator+public@example.com");
  });

  it("returns the requested page with pagination metadata", async () => {
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

  it.each([
    { count: 0, totalPages: 0, hasNextPage: false },
    { count: 200, totalPages: 1, hasNextPage: false },
    { count: 201, totalPages: 2, hasNextPage: true },
    { count: 401, totalPages: 3, hasNextPage: true },
  ])(
    "exposes the full count and continuation for $count pets without page parameters",
    async ({ count, totalPages, hasNextPage }) => {
      const pets = Array.from({ length: count }, (_, index) => ({
        ...approvedPet, id: `pet-${index}`, slug: `pet-${index}`,
      }));
      searchMocks.searchApprovedPets.mockImplementation(createPetSearchService({
        listApprovedPets: async () => pets,
        mode: "lexical",
        semanticSearch: async () => { throw new Error("Unexpected semantic request"); },
      }));
      const { GET: getJson } = await import("@/app/api/pets/route");
      const { GET: getToon } = await import("@/app/api/pets.toon/route");
      const json = await (await getJson(new Request("https://pets.example/api/pets"))).json();
      const toon = decode(await (await getToon(new Request("https://pets.example/api/pets.toon"))).text());

      expect(toon).toEqual(json);
      expect(json.total).toBe(Math.min(count, 200));
      expect(json.pets).toHaveLength(json.total);
      expect(json.pagination).toEqual({
        page: 1, pageSize: 200, totalItems: count,
        totalPages, hasNextPage,
      });
      expect(JSON.stringify(json)).not.toContain("private@example.com");

      const slugs = json.pets.map((pet: { slug: string }) => pet.slug);
      let pagination = json.pagination;
      for (let page = 2; page <= totalPages; page++) {
        expect(pagination.hasNextPage).toBe(true);
        const params = `page=${pagination.page + 1}&pageSize=${pagination.pageSize}`;
        const next = await (await getJson(new Request(`https://pets.example/api/pets?${params}`))).json();
        const nextToon = decode(await (await getToon(new Request(`https://pets.example/api/pets.toon?${params}`))).text());
        expect(nextToon).toEqual(next);
        expect(next.pagination.page).toBe(page);
        slugs.push(...next.pets.map((pet: { slug: string }) => pet.slug));
        pagination = next.pagination;
      }
      expect(pagination.hasNextPage).toBe(false);
      expect(slugs).toEqual(pets.map((pet) => pet.slug));
      expect(new Set(slugs).size).toBe(count);
    },
  );

  it("reports the filtered count with the default window and preserves page-only size", async () => {
    const pets = Array.from({ length: 401 }, (_, index) => ({
      ...approvedPet, id: `pet-${index}`, slug: `pet-${index}`,
      tags: index % 2 === 0 ? ["selected"] : [],
    }));
    searchMocks.searchApprovedPets.mockImplementation(createPetSearchService({
      listApprovedPets: async () => pets,
      mode: "lexical",
      semanticSearch: async () => { throw new Error("Unexpected semantic request"); },
    }));
    const { GET } = await import("@/app/api/pets/route");
    const filtered = await (await GET(new Request("https://pets.example/api/pets?tags=selected"))).json();
    expect(filtered).toMatchObject({
      total: 200,
      pagination: { page: 1, pageSize: 200, totalItems: 201, totalPages: 2, hasNextPage: true },
    });
    const explicit = await (await GET(new Request("https://pets.example/api/pets?tags=selected&page=2"))).json();
    expect(explicit).toMatchObject({
      total: 24,
      pagination: { page: 2, pageSize: 24, totalItems: 201, totalPages: 9, hasNextPage: true },
    });
    expect(explicit.pets[0].slug).toBe("pet-48");
  });

  it.each(["JSON", "TOON"] as const)("rejects a continuation request from a different catalog snapshot (%s)", async (format) => {
    const { GET } = format === "JSON"
      ? await import("@/app/api/pets/route")
      : await import("@/app/api/pets.toon/route");

    const response = await GET(
      new Request("https://pets.example/api/pets?page=2&pageSize=24", {
        headers: {
          "X-Codex-Pets-Catalog-Snapshot": "stale-snapshot",
        },
      }),
    );

    expect(response.status).toBe(409);
    expect(response.headers.get("X-Codex-Pets-Catalog-Snapshot")).toBeTruthy();
    const body = format === "TOON" ? decode(await response.text()) : await response.json();
    expect(body).toMatchObject({
      error: "catalog_snapshot_changed",
      code: "catalog_snapshot_changed",
    });
    expect(searchMocks.searchApprovedPets).not.toHaveBeenCalled();
  });

  it.each(["JSON", "TOON"] as const)("rejects a continuation request from a different ranked result (%s)", async (format) => {
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
    const { GET } = format === "JSON"
      ? await import("@/app/api/pets/route")
      : await import("@/app/api/pets.toon/route");

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
    expect(response.headers.get("X-Codex-Pets-Catalog-Ranking")).toBe("ranking-after-fallback");
    const body = format === "TOON" ? decode(await response.text()) : await response.json();
    expect(body).toMatchObject({
      error: "catalog_ranking_changed",
      code: "catalog_ranking_changed",
    });
  });

  it.each(["JSON", "TOON"] as const)("continues a matching catalog and ranking (%s)", async (format) => {
    const { createApprovedPetsCatalogSnapshot } = await import("@/lib/pets/catalog-snapshot-server");
    const snapshot = createApprovedPetsCatalogSnapshot([approvedPet]);
    searchMocks.searchApprovedPets.mockResolvedValueOnce({
      pets: [approvedPet], total: 25, rankingVersion: "stable-ranking",
    });
    const { GET } = format === "JSON"
      ? await import("@/app/api/pets/route")
      : await import("@/app/api/pets.toon/route");
    const response = await GET(new Request("https://pets.example/api/pets?q=space&page=2&pageSize=24", {
      headers: {
        "X-Codex-Pets-Catalog-Snapshot": snapshot.version,
        "X-Codex-Pets-Catalog-Ranking": "stable-ranking",
      },
    }));
    expect(response.status).toBe(200);
    const body = format === "TOON" ? decode(await response.text()) : await response.json();
    expect(body).toMatchObject({ pets: [{ slug: approvedPet.slug }], pagination: { page: 2 } });
    expect(searchMocks.searchApprovedPets).toHaveBeenCalledWith(
      { q: "space", kind: "all", tags: [], offset: 24, limit: 24 },
      { catalog: snapshot.pets },
    );
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
