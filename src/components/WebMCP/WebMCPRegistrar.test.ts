import { afterEach, describe, expect, it, vi } from "vitest";

import { createSiteTools } from "@/components/WebMCP/WebMCPRegistrar";
import { registerWebMCPTools, type WebMCPTool } from "@/components/WebMCP/webmcp-runtime";

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

  it.each(["a".repeat(49), "a".repeat(64), `${"a".repeat(47)}-`])(
    "looks up a discovered public slug through the registered WebMCP tools: %s",
    async (slug) => {
      vi.stubGlobal("window", { location: { origin: "https://pets.example" } });
      const registered = new Map<string, WebMCPTool>();
      vi.stubGlobal("navigator", {
        modelContext: {
          registerTool: (tool: WebMCPTool) => registered.set(tool.name, tool),
          unregisterTool: (name: string) => registered.delete(name),
        },
      });
      const pet = createPet(slug, "Public pet");
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(Response.json({ pets: [pet], total: 1 }))
        .mockResolvedValueOnce(Response.json({ pet }));
      vi.stubGlobal("fetch", fetchMock);
      const unregister = registerWebMCPTools(createSiteTools());
      try {
        const search = registered.get("search_codex_pets");
        const lookup = registered.get("get_codex_pet");
        if (!search || !lookup) throw new Error("Expected registered public tools");
        for (const tool of registered.values()) expect(tool.annotations?.readOnlyHint).toBe(true);
        const found = await search.execute({});
        expect(found.structuredContent).toMatchObject({ pets: [{ slug }] });
        const result = await lookup.execute({ slug });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({ pet: { slug } });
        expect(fetchMock).toHaveBeenLastCalledWith(`/api/pets/${slug}`, expect.anything());
      } finally {
        unregister();
      }
      expect(registered.size).toBe(0);
    },
  );

  it("rejects an oversized lookup before making a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const lookup = createSiteTools().find((tool) => tool.name === "get_codex_pet");
    if (!lookup) throw new Error("Expected public lookup tool");
    expect((await lookup.execute({ slug: "a".repeat(65) })).isError).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
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
