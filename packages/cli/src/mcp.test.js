import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { describe, expect, it, vi } from "vitest";

import { DEFAULT_BASE_URL, normalizeBaseUrl } from "./lib.js";
import { createCodexPetsLocalMcpServer, createRemoteCodexPetsDataSource } from "./mcp.js";

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
      installCommand: "npx @astandrik/codex-pets install orbit-otter --url 'https://pets.test'",
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
      install: { command: "npx @astandrik/codex-pets install orbit-otter --url 'https://pets.test'" },
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
  it.each(["a".repeat(49), "a".repeat(64), "legacy-"])("supports public lookup slugs in search and detail: %s", async (slug) => {
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({ pets: [manifestPet(slug)] }),
      [`GET https://pets.test/api/pets/${slug}/share`]: jsonResponse(sharePayload(slug)),
    });
    const source = createRemoteCodexPetsDataSource({ baseUrl: "https://pets.test", fetchImpl });
    expect((await source.searchPets()).pets[0].slug).toBe(slug);
    expect((await source.getPet(` ${slug} `)).pet.slug).toBe(slug);
  });

  it.each(["../boba", "a".repeat(65), "", null])("rejects invalid direct lookup before HTTP: %j", async (slug) => {
    const fetchImpl = vi.fn();
    const source = createRemoteCodexPetsDataSource({ fetchImpl });
    await expect(source.getPet(slug)).rejects.toThrow("Invalid pet slug");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    ["getPet", { pet: {}, share: {} }],
    ["getPet", sharePayload("other")],
    ["getPet", { ...sharePayload("boba"), pet: { slug: "boba", name: 5 } }],
    ["getInstallInstructions", { pet: { slug: "boba", name: "Boba" }, share: { install: {} } }],
    ["getBadgeCode", { pet: { slug: "boba", name: "Boba" }, share: { badge: { markdown: "x" } } }],
    ["getEmbedCode", { pet: { slug: "boba", name: "Boba" }, share: { embed: null } }],
    ["getCardCode", { pet: { slug: "boba", name: "Boba" }, share: { card: [] } }],
  ])("rejects malformed share data at %s", async (method, payload) => {
    const source = createRemoteCodexPetsDataSource({ baseUrl: "https://pets.test", fetchImpl: createFetch({
      "GET https://pets.test/api/pets/boba/share": jsonResponse(payload),
    }) });
    await expect(source[method]("boba")).rejects.toThrow("Share response for boba is malformed");
  });

  it.each([DEFAULT_BASE_URL, "https://pets.test/gallery", "https://pets.test/$(echo)'quoted"])("keeps gallery identity in every install command: %s", async (baseUrl) => {
    const normalized = normalizeBaseUrl(baseUrl);
    const install = {
      command: "npx @astandrik/codex-pets install boba",
      codex: { command: "npx @astandrik/codex-pets install boba", mcpServer: { addCommand: "remote MCP", configToml: "remote config" } },
      cursor: { command: "npx @astandrik/codex-pets install boba", note: "preserved" },
      claudeCode: { command: "npx @astandrik/codex-pets install boba" },
      manual: { steps: ["Download package.", "Install with npx @astandrik/codex-pets install boba when the npm CLI is available."] },
    };
    const payload = sharePayload("boba");
    payload.pet.install = install;
    payload.pet.installCommand = install.command;
    payload.share.install = install;
    const source = createRemoteCodexPetsDataSource({ baseUrl, fetchImpl: vi.fn(async (url) => jsonResponse(
      String(url).endsWith("/api/manifest") ? { pets: [manifestPet("boba")] } : payload,
    )) });
    const search = (await source.searchPets()).pets[0];
    const detail = (await source.getPet("boba")).pet;
    const instructions = (await source.getInstallInstructions("boba")).install;
    const expected = ["npx", "@astandrik/codex-pets", "install", "boba"];
    if (normalized !== DEFAULT_BASE_URL) expected.push("--url", normalized);
    const candidates = [search.installCommand, search.install, detail.installCommand, detail.install, instructions];
    for (const candidate of candidates) {
      const commands = typeof candidate === "string" ? [candidate] : [candidate.command, candidate.codex.command, candidate.cursor.command, candidate.claudeCode.command];
      for (const command of commands) {
        if (process.platform !== "win32") {
          const args = execFileSync("sh", ["-c", `set -- ${command}; printf '%s\\0' "$@"`], { encoding: "utf8" }).split("\0").slice(0, -1);
          expect(args).toEqual(expected);
        }
      }
    }
    expect(instructions.cursor.note).toBe("preserved");
    if (normalized !== DEFAULT_BASE_URL) {
      expect(instructions.manual.steps[1]).toContain(instructions.command);
      expect(instructions.codex.mcpServer.addCommand).toContain("--url '");
    }
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

describe("MCP protocol boundary", () => {
  it("exposes only read-only tools and maps valid, invalid, missing and failed requests", async () => {
    const fetchImpl = createFetch({
      "GET https://pets.test/api/pets/boba/share": jsonResponse(sharePayload("boba")),
    });
    const server = createCodexPetsLocalMcpServer({ baseUrl: "https://pets.test", fetchImpl });
    const client = new Client({ name: "test-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual([
        "get_badge_code", "get_card_code", "get_embed_code", "get_install_instructions", "get_pet", "get_pet_request_info", "search_pets",
      ]);
      expect(tools.every((tool) => tool.annotations.readOnlyHint && !tool.annotations.destructiveHint)).toBe(true);
      const valid = await client.callTool({ name: "get_pet", arguments: { slug: "boba" } });
      expect(valid.isError).not.toBe(true);
      expect(valid.structuredContent.pet.slug).toBe("boba");
      for (const [slug, code] of [["../boba", "invalid_argument"], ["missing", "not_found"]]) {
        const result = await client.callTool({ name: "get_pet", arguments: { slug } });
        expect(result.isError).toBe(true);
        expect(result.structuredContent.error.code).toBe(code);
      }
      fetchImpl.mockRejectedValueOnce(new Error("offline"));
      const failure = await client.callTool({ name: "get_pet", arguments: { slug: "boba" } });
      expect(failure.isError).toBe(true);
      expect(failure.structuredContent.error.code).toBe("internal_error");
      expect(fetchImpl.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
