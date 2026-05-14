import { describe, expect, it } from "vitest";

import {
  createAgentPet,
  enrichManifestPet,
  normalizeLimit,
  normalizeSearchCodexPetsInput,
  readSafeSlugInput,
  WEBMCP_DEFAULT_PET_LIMIT,
  WEBMCP_MAX_PET_LIMIT,
  type WebMCPPetInput,
} from "@/components/WebMCP/webmcp-utils";

describe("webmcp-utils", () => {
  it("normalizes search input with safe defaults", () => {
    expect(normalizeSearchCodexPetsInput({ query: "  blue   bot  " })).toEqual({
      query: "blue bot",
      kind: "all",
      limit: WEBMCP_DEFAULT_PET_LIMIT,
    });
    expect(normalizeSearchCodexPetsInput({ kind: "object", limit: 3 })).toEqual({
      kind: "object",
      limit: 3,
    });
    expect(normalizeSearchCodexPetsInput({ kind: "bad", limit: 999 })).toEqual({
      kind: "all",
      limit: WEBMCP_MAX_PET_LIMIT,
    });
  });

  it("clamps limits", () => {
    expect(normalizeLimit(0)).toBe(1);
    expect(normalizeLimit(1.8)).toBe(1);
    expect(normalizeLimit("12")).toBe(12);
    expect(normalizeLimit(Number.NaN)).toBe(WEBMCP_DEFAULT_PET_LIMIT);
    expect(normalizeLimit(1000)).toBe(WEBMCP_MAX_PET_LIMIT);
  });

  it("accepts only safe slugs", () => {
    const truncatedSlugWithTrailingDash = `${"a".repeat(47)}-`;

    expect(readSafeSlugInput({ slug: "zero-two-2" })).toBe("zero-two-2");
    expect(readSafeSlugInput({ slug: truncatedSlugWithTrailingDash })).toBe(
      truncatedSlugWithTrailingDash,
    );
    expect(readSafeSlugInput({ slug: "../admin" })).toBeNull();
    expect(readSafeSlugInput({ slug: "-bad" })).toBeNull();
  });

  it("creates agent pet output without private contact fields", () => {
    const pet: WebMCPPetInput = {
      slug: "zero-two-2",
      displayName: "Zero Two",
      description: "A companion.",
      spritesheetUrl: "/api/assets/a/spritesheet.webp",
      petJsonUrl: "/api/assets/a/pet.json",
      zipUrl: "/api/assets/a/pet.zip",
      kind: "character",
      tags: ["pink"],
      status: "approved",
      ownerName: "Creator",
      createdAt: "2026-05-01T00:00:00.000Z",
      approvedAt: "2026-05-02T00:00:00.000Z",
    };

    expect(createAgentPet(pet, "https://pets.example")).toEqual({
      slug: "zero-two-2",
      displayName: "Zero Two",
      description: "A companion.",
      kind: "character",
      tags: ["pink"],
      status: "approved",
      ownerName: "Creator",
      createdAt: "2026-05-01T00:00:00.000Z",
      approvedAt: "2026-05-02T00:00:00.000Z",
      pageUrl: "https://pets.example/pets/zero-two-2",
      petJsonUrl: "https://pets.example/api/assets/a/pet.json",
      spritesheetUrl: "https://pets.example/api/assets/a/spritesheet.webp",
      zipUrl: "https://pets.example/api/assets/a/pet.zip",
      installCommand: "npx @astandrik/codex-pets install zero-two-2",
    });
  });

  it("enriches manifest pet links for agents", () => {
    expect(
      enrichManifestPet(
        {
          slug: "zero-two-2",
          spritesheetUrl: "/api/assets/a/spritesheet.webp",
          petJsonUrl: "/api/assets/a/pet.json",
          zipUrl: "/api/assets/a/pet.zip",
        },
        "https://pets.example",
      ),
    ).toEqual({
      slug: "zero-two-2",
      pageUrl: "https://pets.example/pets/zero-two-2",
      spritesheetUrl: "https://pets.example/api/assets/a/spritesheet.webp",
      petJsonUrl: "https://pets.example/api/assets/a/pet.json",
      zipUrl: "https://pets.example/api/assets/a/pet.zip",
      installCommand: "npx @astandrik/codex-pets install zero-two-2",
    });
  });
});
