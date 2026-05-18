import { describe, expect, it, vi } from "vitest";

import { createRemoteCodexPetsDataSource } from "./mcp.js";

describe("codex-pets local MCP data source", () => {
  it("searches manifest pets and builds agent-friendly output", async () => {
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({
        pets: [
          manifestPet("orbit-otter", {
            description: "A space otter companion.",
            tags: ["space", "friendly"],
            submittedBy: "Anton",
          }),
        ],
      }),
    });

    const source = createRemoteCodexPetsDataSource({
      baseUrl: "https://pets.test",
      fetchImpl,
    });

    const result = await source.searchPets({
      query: "space",
      tags: ["friendly"],
      author: "Anton",
      compatibleWith: ["codex"],
    });

    expect(result.total).toBe(1);
    expect(result.pets[0]).toMatchObject({
      slug: "orbit-otter",
      name: "Orbit Otter",
      compatibleWith: ["codex"],
      installCommand: "npx @astandrik/codex-pets install orbit-otter",
    });
    expect(result.pets[0].badge.svgUrl).toBe("https://pets.test/badge/orbit-otter.svg");
    expect(result.pets[0].embed.url).toContain("/embed/orbit-otter?");
  });

  it("returns install, badge, card, and embed snippets from the public share route", async () => {
    const share = sharePayload("orbit-otter");
    const fetchImpl = createFetch({
      "GET https://pets.test/api/pets/orbit-otter/share": jsonResponse(share),
    });

    const source = createRemoteCodexPetsDataSource({
      baseUrl: "https://pets.test",
      fetchImpl,
    });

    await expect(source.getPet("orbit-otter")).resolves.toEqual({ pet: share.pet });
    await expect(source.getInstallInstructions("orbit-otter")).resolves.toEqual({
      slug: "orbit-otter",
      name: "Orbit Otter",
      install: share.share.install,
    });
    await expect(source.getBadgeCode("orbit-otter")).resolves.toEqual({
      slug: "orbit-otter",
      name: "Orbit Otter",
      badge: share.share.badge,
    });
    await expect(source.getEmbedCode("orbit-otter")).resolves.toEqual({
      slug: "orbit-otter",
      name: "Orbit Otter",
      embed: share.share.embed,
    });
    await expect(source.getCardCode("orbit-otter")).resolves.toEqual({
      slug: "orbit-otter",
      name: "Orbit Otter",
      card: share.share.card,
    });
  });
});

function manifestPet(slug, overrides = {}) {
  return {
    slug,
    displayName: "Orbit Otter",
    description: "Friendly companion",
    kind: "creature",
    tags: ["space"],
    submittedBy: "Creator",
    pageUrl: `https://pets.test/pets/${slug}`,
    spritesheetUrl: "https://pets.test/api/assets/a/spritesheet.webp",
    petJsonUrl: "https://pets.test/api/assets/a/pet.json",
    zipUrl: "https://pets.test/api/assets/a/pet.zip",
    createdAt: "2026-05-01T00:00:00.000Z",
    approvedAt: "2026-05-02T00:00:00.000Z",
    ...overrides,
  };
}

function sharePayload(slug) {
  return {
    pet: {
      slug,
      name: "Orbit Otter",
    },
    share: {
      install: {
        command: `npx @astandrik/codex-pets install ${slug}`,
      },
      badge: {
        markdown: "badge-md",
        html: "badge-html",
      },
      card: {
        markdown: "card-md",
        html: "card-html",
      },
      embed: {
        iframe: "iframe-html",
        url: `https://pets.test/embed/${slug}`,
      },
    },
  };
}

function createFetch(routes) {
  return vi.fn(async (url, init = {}) => {
    const method = init.method ?? "GET";
    const response = routes[`${method} ${String(url)}`];
    if (!response) {
      return jsonResponse({ error: "not_found" }, 404);
    }
    return response;
  });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}
