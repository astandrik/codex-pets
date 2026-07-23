import { afterEach, describe, expect, it, vi } from "vitest";

import { createSiteTools } from "@/components/WebMCP/WebMCPRegistrar";

describe("WebMCP search tool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the unified API ranking without applying another query filter", async () => {
    vi.stubGlobal("window", { location: { origin: "https://pets.example" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          total: 2,
          pets: [
            createPet("velvet-luma", "Velvet Luma"),
            createPet("orbit-otter", "Orbit Otter"),
          ],
        }),
      ),
    );
    const search = createSiteTools().find(
      (tool) => tool.name === "search_codex_pets",
    );

    const result = await search?.execute({ query: "sexy", limit: 10 });
    const pets = result?.structuredContent?.pets as Array<{ slug: string }>;

    expect(pets.map((pet) => pet.slug)).toEqual([
      "velvet-luma",
      "orbit-otter",
    ]);
    expect(JSON.stringify(result?.structuredContent)).not.toMatch(
      /captionJson|captionText|sourceHash|visualMode|visualFallbackReason/,
    );
  });
});

function createPet(slug: string, displayName: string) {
  return {
    slug,
    displayName,
    description: "Does not repeat the user query.",
    spritesheetUrl: `/api/assets/${slug}/spritesheet.webp`,
    petJsonUrl: `/api/assets/${slug}/pet.json`,
    zipUrl: `/api/assets/${slug}/pet.zip`,
    kind: "character",
    tags: ["gothic"],
    status: "approved",
    ownerName: "Creator",
    ownerProfileSlug: "creator",
    createdAt: "2026-07-01T00:00:00.000Z",
    approvedAt: "2026-07-02T00:00:00.000Z",
    captionJson: '{"internal":true}',
    captionText: "internal visual caption",
    sourceHash: "internal-source-hash",
  };
}
