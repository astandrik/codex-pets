import { decode } from "@toon-format/toon";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  findInternalSearchFieldPaths,
} from "@/lib/pets/search-public-contract";

const searchMocks = vi.hoisted(() => ({
  searchApprovedPets: vi.fn(),
}));

vi.mock("@/lib/pets/search-runtime", () => ({
  searchApprovedPets: searchMocks.searchApprovedPets,
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
  internalSearch: {
    captionEnvelope: { accessories: "internal accessory" },
    sourceHash: "internal-source-hash",
    provenance: "visual-v2",
    scores: [0.99],
    prompt: "internal prompt",
  },
};

describe("GET /api/pets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
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
    expect(findInternalSearchFieldPaths(body)).toEqual([]);
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
    expect(findInternalSearchFieldPaths(jsonBody)).toEqual([]);
    expect(findInternalSearchFieldPaths(toonBody)).toEqual([]);
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
      expect(findInternalSearchFieldPaths(body)).toEqual([]);
    },
  );
});
