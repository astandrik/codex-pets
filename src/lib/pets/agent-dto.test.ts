import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicPet } from "@/lib/pets/types";

const approvedPet: PublicPet = {
  id: "pet_1",
  slug: "orbit-otter",
  displayName: "Orbit Otter",
  description: "A compact space helper.",
  spritesheetUrl: "/api/assets/asset_1/spritesheet.webp",
  petJsonUrl: "/api/assets/asset_1/pet.json",
  zipUrl: "/api/assets/asset_1/pet.zip",
  spritesheetExt: "webp",
  kind: "creature",
  tags: ["space", "friendly"],
  status: "approved",
  ownerName: "Local Admin",
  contactEmail: "private@example.com",
  createdAt: "2026-05-01T00:00:00.000Z",
  approvedAt: "2026-05-02T00:00:00.000Z",
  downloadCount: 12,
  installCount: 5,
  likeCount: 3,
};

describe("agent DTO", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("maps approved pets to public agent cards without private fields", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    const { createAgentPet } = await import("@/lib/pets/agent-dto");
    const dto = createAgentPet(approvedPet);

    expect(dto).toMatchObject({
      slug: "orbit-otter",
      name: "Orbit Otter",
      displayName: "Orbit Otter",
      author: { name: "Local Admin" },
      pageUrl: "https://pets.example/pets/orbit-otter",
      petJsonUrl: "https://pets.example/api/assets/asset_1/pet.json",
      manifestUrl: "https://pets.example/api/assets/asset_1/pet.json",
      spritesheetUrl: "https://pets.example/api/assets/asset_1/spritesheet.webp",
      zipUrl: "https://pets.example/api/assets/asset_1/pet.zip",
      packageUrl: "https://pets.example/api/assets/asset_1/pet.zip",
      previewImageUrl: "https://pets.example/api/assets/asset_1/preview.webp",
      idleStripUrl: "https://pets.example/api/assets/asset_1/idle-strip.webp",
      installPrompt:
        "Install the Orbit Otter Codex pet from https://pets.example/pets/orbit-otter",
      card: {
        gifUrl:
          "https://pets.example/card/orbit-otter.gif?mode=sprite&scale=2&state=idle",
        width: 384,
        height: 416,
      },
      embed: {
        url: "https://pets.example/embed/orbit-otter?mode=sprite&scale=2&state=idle",
        width: 384,
        height: 416,
      },
      compatibleWith: ["codex"],
      license: "unknown",
      validation: {
        status: "valid",
        source: "registry_approval",
        messages: [],
      },
    });
    expect(JSON.stringify(dto)).not.toContain("private@example.com");
    expect(JSON.stringify(dto)).not.toContain("downloadCount");
    expect(JSON.stringify(dto)).not.toContain("installCount");
    expect(JSON.stringify(dto)).not.toContain("likeCount");
  });

  it("does not rewrite external asset URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://pets.example");

    const { createAgentPet } = await import("@/lib/pets/agent-dto");
    const dto = createAgentPet({
      ...approvedPet,
      spritesheetUrl: "https://assets.example/spritesheet.webp",
      petJsonUrl: "https://assets.example/pet.json",
      zipUrl: "https://assets.example/pet.zip",
    });

    expect(dto.spritesheetUrl).toBe("https://assets.example/spritesheet.webp");
    expect(dto.petJsonUrl).toBe("https://assets.example/pet.json");
    expect(dto.zipUrl).toBe("https://assets.example/pet.zip");
    expect(dto.previewImageUrl).toBeNull();
    expect(dto.idleStripUrl).toBeNull();
  });

  it("normalizes search filters and clamps limits", async () => {
    const {
      AGENT_MAX_PET_LIMIT,
      normalizeAgentSearchFilters,
    } = await import("@/lib/pets/agent-dto");

    expect(
      normalizeAgentSearchFilters({
        query: "  space   helper ",
        kind: "object",
        tags: "space, friendly, space",
        author: " admin ",
        compatibleWith: "codex",
        limit: 999,
      }),
    ).toEqual({
      query: "space helper",
      kind: "object",
      tags: ["space", "friendly"],
      author: "admin",
      compatibleWith: ["codex"],
      limit: AGENT_MAX_PET_LIMIT,
    });
  });

  it("filters by tags, author, kind, query, and compatibility", async () => {
    const { filterAgentPets, normalizeAgentSearchFilters } = await import(
      "@/lib/pets/agent-dto"
    );
    const objectPet: PublicPet = {
      ...approvedPet,
      slug: "terminal-cube",
      displayName: "Terminal Cube",
      kind: "object",
      tags: ["terminal"],
      ownerName: "Other Creator",
    };

    expect(
      filterAgentPets(
        [approvedPet, objectPet],
        normalizeAgentSearchFilters({
          query: "space",
          tags: ["friendly"],
          author: "local",
          compatibleWith: ["codex"],
        }),
      ).map((pet) => pet.slug),
    ).toEqual(["orbit-otter"]);
    expect(
      filterAgentPets(
        [approvedPet, objectPet],
        normalizeAgentSearchFilters({
          compatibleWith: ["other-agent"],
        }),
      ),
    ).toEqual([]);
  });

  it("parses safe slugs for pets and badge files", async () => {
    const { readSafeAgentSlug, readSafeBadgeSlug, readSafeCardSlug } = await import(
      "@/lib/pets/agent-dto"
    );
    const trailingHyphenSlug = `${"a".repeat(47)}-`;

    expect(readSafeAgentSlug("orbit-otter")).toBe("orbit-otter");
    expect(readSafeAgentSlug(trailingHyphenSlug)).toBe(trailingHyphenSlug);
    expect(readSafeAgentSlug("../admin")).toBeNull();
    expect(readSafeBadgeSlug("orbit-otter.svg")).toBe("orbit-otter");
    expect(readSafeBadgeSlug("orbit-otter.png")).toBeNull();
    expect(readSafeCardSlug("orbit-otter.gif")).toBe("orbit-otter");
    expect(readSafeCardSlug("orbit-otter.png")).toBeNull();
  });
});
