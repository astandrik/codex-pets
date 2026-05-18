import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";

import {
  buildApiUrl,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  toAbsoluteUrl,
} from "./lib.js";
import { CODEX_PETS_CLI_VERSION } from "./version.js";

const READ_ONLY_TOOL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 60;
const DEFAULT_SHARE_SCALE = 2;
const DEFAULT_SHARE_STATE = "idle";
const PET_KINDS = new Set(["creature", "object", "character"]);

export function createRemoteCodexPetsDataSource(options = {}) {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("This CLI requires a runtime with fetch support.");
  }

  return {
    baseUrl,
    async searchPets(input = {}) {
      const manifest = await fetchJson(
        fetchImpl,
        buildApiUrl(baseUrl, "/api/manifest"),
        "manifest",
      );

      if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.pets)) {
        throw new Error("Manifest response must contain a pets array.");
      }

      const filters = normalizeSearchFilters(input);
      const pets = manifest.pets
        .map((pet) => normalizeManifestPet(pet, baseUrl))
        .filter((pet) => matchesFilters(pet, filters))
        .slice(0, filters.limit)
        .map((pet) => createAgentPetFromManifest(pet, baseUrl));

      return {
        total: pets.length,
        limit: filters.limit,
        pets,
      };
    },
    async getPet(slug) {
      const share = await fetchSharePayload(fetchImpl, baseUrl, slug);
      return { pet: share.pet };
    },
    async getInstallInstructions(slug) {
      const share = await fetchSharePayload(fetchImpl, baseUrl, slug);
      return {
        slug: share.pet.slug,
        name: share.pet.name,
        install: share.share.install,
      };
    },
    async getBadgeCode(slug) {
      const share = await fetchSharePayload(fetchImpl, baseUrl, slug);
      return {
        slug: share.pet.slug,
        name: share.pet.name,
        badge: share.share.badge,
      };
    },
    async getEmbedCode(slug) {
      const share = await fetchSharePayload(fetchImpl, baseUrl, slug);
      return {
        slug: share.pet.slug,
        name: share.pet.name,
        embed: share.share.embed,
      };
    },
    async getCardCode(slug) {
      const share = await fetchSharePayload(fetchImpl, baseUrl, slug);
      return {
        slug: share.pet.slug,
        name: share.pet.name,
        card: share.share.card,
      };
    },
    async getPetRequestInfo() {
      return buildPetRequestInfo(baseUrl);
    },
  };
}

export function createCodexPetsLocalMcpServer(options = {}) {
  const dataSource = createRemoteCodexPetsDataSource(options);
  const server = new McpServer({
    name: "codex-pets-local",
    version: CODEX_PETS_CLI_VERSION,
  });

  const slugSchema = {
    slug: z.string().describe("Exact slug of an approved public Codex pet."),
  };

  const searchSchema = {
    query: z.string().describe(
      "Optional text matched against approved pet names, descriptions, tags, and authors.",
    ).optional(),
    kind: z.enum(["all", "creature", "object", "character"]).describe(
      "Optional pet kind filter. Use all or omit the field to include every kind.",
    ).optional(),
    tags: z.union([z.string(), z.array(z.string())]).describe(
      "Optional tag filter as a comma-separated string or array. All provided tags must match.",
    ).optional(),
    author: z.string().describe(
      "Optional author name text matched against the public submitter name.",
    ).optional(),
    compatibleWith: z.union([z.string(), z.array(z.string())]).describe(
      "Optional compatibility filter. Use codex for Codex-compatible pets; other values return no matches.",
    ).optional(),
    limit: z.union([z.number(), z.string()]).describe(
      "Optional maximum result count. Defaults to 10 and is clamped to 1-60.",
    ).optional(),
  };

  server.registerTool(
    "search_pets",
    {
      title: "Search Codex pets",
      description:
        "Use to discover one or more approved public Codex pet packs by query, kind, tags, author, or Codex compatibility. Prefer this over get_pet when you do not already have an exact slug or need multiple candidates. Do not use for private generation requests or known-slug install/share snippets; use get_pet_request_info or a slug-specific get_* tool instead.",
      inputSchema: searchSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => runTool(() => dataSource.searchPets(args)),
  );

  server.registerTool(
    "get_pet",
    {
      title: "Get Codex pet",
      description:
        "Use when you already have an exact approved pet slug and need the sanitized public pet card, asset URLs, page URL, and install command for that one pet. Use search_pets first when you only have a name/query or need multiple results. Do not use for focused install, badge, embed, card, or request workflow details; use the matching get_* tool instead.",
      inputSchema: slugSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => runTool(() => dataSource.getPet(readSlug(args.slug))),
  );

  server.registerTool(
    "get_install_instructions",
    {
      title: "Get install instructions",
      description:
        "Use for a known approved pet slug when the user wants CLI or manual install instructions. Do not use to search for pets or inspect general metadata; use search_pets or get_pet instead. This tool is read-only and does not increment install or download counters.",
      inputSchema: slugSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) =>
      runTool(() => dataSource.getInstallInstructions(readSlug(args.slug))),
  );

  server.registerTool(
    "get_badge_code",
    {
      title: "Get README badge code",
      description:
        "Use for a known approved pet slug when the user needs README badge Markdown, HTML, or SVG URL. Do not use for animated README cards, website iframe embeds, install instructions, or pet discovery; use get_card_code, get_embed_code, get_install_instructions, or search_pets instead.",
      inputSchema: slugSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => runTool(() => dataSource.getBadgeCode(readSlug(args.slug))),
  );

  server.registerTool(
    "get_embed_code",
    {
      title: "Get website embed code",
      description:
        "Use for a known approved pet slug when the user needs website iframe embed HTML or an embed URL. Do not use for README badges/cards, install instructions, or pet discovery; use get_badge_code, get_card_code, get_install_instructions, or search_pets instead.",
      inputSchema: slugSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => runTool(() => dataSource.getEmbedCode(readSlug(args.slug))),
  );

  server.registerTool(
    "get_card_code",
    {
      title: "Get animated README card code",
      description:
        "Use for a known approved pet slug when the user needs animated README card Markdown, HTML, or GIF URL. Do not use for simple badges, website iframe embeds, install instructions, or pet discovery; use get_badge_code, get_embed_code, get_install_instructions, or search_pets instead.",
      inputSchema: slugSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => runTool(() => dataSource.getCardCode(readSlug(args.slug))),
  );

  server.registerTool(
    "get_pet_request_info",
    {
      title: "Get pet request info",
      description:
        "Use when the user wants to request a new Codex pet or understand the public request form fields and reference image limits. Do not use to create, submit, update, or inspect private generation requests; no MCP tool exposes those operations. Use search_pets or get_pet for existing approved pets.",
      inputSchema: {},
      annotations: READ_ONLY_TOOL,
    },
    async () => runTool(() => dataSource.getPetRequestInfo()),
  );

  return server;
}

export async function runMcpServer(options = {}) {
  const server = createCodexPetsLocalMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function normalizeSearchFilters(input = {}) {
  return {
    query: normalizeQuery(input.query),
    kind: normalizeKind(input.kind),
    tags: normalizeList(input.tags),
    author: normalizeQuery(input.author),
    compatibleWith: normalizeList(input.compatibleWith),
    limit: normalizeLimit(input.limit),
  };
}

function normalizeManifestPet(pet, baseUrl) {
  const fields = [
    "slug",
    "displayName",
    "description",
    "kind",
    "tags",
    "petJsonUrl",
    "spritesheetUrl",
    "zipUrl",
    "pageUrl",
  ];
  for (const field of fields) {
    if (pet?.[field] == null) {
      throw new Error(`Manifest pet is missing ${field}.`);
    }
  }
  if (!Array.isArray(pet.tags)) {
    throw new Error("Manifest pet tags must be an array.");
  }
  return {
    slug: readSlug(pet.slug),
    displayName: String(pet.displayName),
    description: String(pet.description),
    kind: normalizeKind(pet.kind),
    tags: pet.tags.map((tag) => String(tag)).filter(Boolean),
    submittedBy: typeof pet.submittedBy === "string" ? pet.submittedBy : null,
    pageUrl: toAbsoluteUrl(String(pet.pageUrl), baseUrl),
    petJsonUrl: toAbsoluteUrl(String(pet.petJsonUrl), baseUrl),
    spritesheetUrl: toAbsoluteUrl(String(pet.spritesheetUrl), baseUrl),
    zipUrl: toAbsoluteUrl(String(pet.zipUrl), baseUrl),
    createdAt: typeof pet.createdAt === "string" ? pet.createdAt : "",
    approvedAt: typeof pet.approvedAt === "string" ? pet.approvedAt : null,
  };
}

function matchesFilters(pet, filters) {
  if (filters.kind !== "all" && pet.kind !== filters.kind) {
    return false;
  }

  if (filters.compatibleWith.length > 0) {
    const compatible = filters.compatibleWith.map((value) => value.toLowerCase());
    if (!compatible.includes("codex")) {
      return false;
    }
  }

  if (filters.tags.length > 0) {
    const petTags = pet.tags.map((tag) => tag.toLowerCase());
    for (const tag of filters.tags) {
      if (!petTags.includes(tag.toLowerCase())) {
        return false;
      }
    }
  }

  if (filters.author) {
    const author = (pet.submittedBy ?? "").toLowerCase();
    if (!author.includes(filters.author.toLowerCase())) {
      return false;
    }
  }

  if (!filters.query) {
    return true;
  }

  const query = filters.query.toLowerCase();
  return (
    pet.displayName.toLowerCase().includes(query) ||
    pet.description.toLowerCase().includes(query) ||
    pet.tags.some((tag) => tag.toLowerCase().includes(query)) ||
    (pet.submittedBy ?? "").toLowerCase().includes(query)
  );
}

function createAgentPetFromManifest(pet, baseUrl) {
  const shareParams = new URLSearchParams({
    mode: "sprite",
    scale: String(DEFAULT_SHARE_SCALE),
    state: DEFAULT_SHARE_STATE,
  });

  const badgeUrl = buildPublicUrl(baseUrl, `/badge/${encodeURIComponent(pet.slug)}.svg`);
  const cardUrl = buildPublicUrl(
    baseUrl,
    `/card/${encodeURIComponent(pet.slug)}.gif`,
    shareParams,
  );
  const embedUrl = buildPublicUrl(
    baseUrl,
    `/embed/${encodeURIComponent(pet.slug)}`,
    shareParams,
  );
  const previewImageUrl = derivePetAssetUrl(pet.spritesheetUrl, "preview.webp");
  const idleStripUrl = derivePetAssetUrl(pet.spritesheetUrl, "idle-strip.webp");
  const mcpUrl = buildPublicUrl(baseUrl, "/mcp");
  const installCommand = `npx @astandrik/codex-pets install ${pet.slug}`;

  return {
    slug: pet.slug,
    name: pet.displayName,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    tags: pet.tags,
    status: "approved",
    author: {
      name: pet.submittedBy ?? "Anonymous",
    },
    pageUrl: pet.pageUrl,
    petJsonUrl: pet.petJsonUrl,
    manifestUrl: pet.petJsonUrl,
    spritesheetUrl: pet.spritesheetUrl,
    zipUrl: pet.zipUrl,
    packageUrl: pet.zipUrl,
    previewImageUrl,
    idleStripUrl,
    installCommand,
    installPrompt: `Install the ${pet.displayName} Codex pet from ${pet.pageUrl}`,
    install: {
      slug: pet.slug,
      command: installCommand,
      codex: {
        command: installCommand,
        mcpServer: {
          addCommand: `codex mcp add codexPets --url ${mcpUrl}`,
          configToml: [
            "[mcp_servers.codexPets]",
            `url = "${mcpUrl}"`,
          ].join("\n"),
        },
      },
      cursor: {
        command: installCommand,
        note: "Run the CLI from your local shell, then restart or refresh your coding agent if it caches pet assets.",
      },
      claudeCode: {
        command: installCommand,
        note: "Run the CLI from your local shell. The package format is the same Codex pet.json plus spritesheet atlas.",
      },
      manual: {
        steps: [
          `Download the package ZIP from ${pet.zipUrl}.`,
          `Use ${pet.petJsonUrl} for pet.json metadata.`,
          `Use ${pet.spritesheetUrl} for the spritesheet atlas.`,
          `Install with ${installCommand} when the npm CLI is available.`,
        ],
      },
    },
    badge: {
      markdown: `[![${escapeMarkdownAlt(`Codex pet: ${pet.displayName}`)}](${badgeUrl})](${pet.pageUrl})`,
      html: `<a href="${escapeHtmlAttribute(pet.pageUrl)}"><img alt="${escapeHtmlAttribute(`Codex pet: ${pet.displayName}`)}" src="${escapeHtmlAttribute(badgeUrl)}"></a>`,
      svgUrl: badgeUrl,
    },
    card: {
      markdown: `[![${escapeMarkdownAlt(`${pet.displayName} Codex pet`)}](${cardUrl})](${pet.pageUrl})`,
      html: `<a href="${escapeHtmlAttribute(pet.pageUrl)}"><img alt="${escapeHtmlAttribute(`${pet.displayName} Codex pet`)}" src="${escapeHtmlAttribute(cardUrl)}" width="384" height="416"></a>`,
      gifUrl: cardUrl,
      width: 384,
      height: 416,
    },
    embed: {
      iframe: `<iframe title="${escapeHtmlAttribute(`Codex pet: ${pet.displayName}`)}" src="${escapeHtmlAttribute(embedUrl)}" width="384" height="416" loading="lazy"></iframe>`,
      url: embedUrl,
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
    createdAt: pet.createdAt,
    approvedAt: pet.approvedAt,
  };
}

function buildPetRequestInfo(baseUrl) {
  return {
    request: {
      pageUrl: buildPublicUrl(baseUrl, "/request"),
      method: "Open the public request page and submit the form there.",
      privacy:
        "Pet generation requests are private to admins. Completed pets are linked manually after upload.",
      fields: [
        {
          name: "contactEmail",
          required: true,
          description: "Contact email for follow-up about the request.",
        },
        {
          name: "prompt",
          required: true,
          maxLength: 2000,
          description:
            "Short brief describing the character, object, mood, colors, and must-have details.",
        },
        {
          name: "kind",
          required: false,
          values: ["creature", "object", "character"],
          default: "creature",
        },
        {
          name: "requesterName",
          required: false,
          maxLength: 80,
        },
        {
          name: "displayNameHint",
          required: false,
          maxLength: 80,
        },
        {
          name: "referenceImage",
          required: false,
          contentTypes: ["image/png", "image/jpeg", "image/webp"],
          maxBytes: 5242880,
        },
      ],
    },
  };
}

async function fetchSharePayload(fetchImpl, baseUrl, slug) {
  const response = await fetchJson(
    fetchImpl,
    buildApiUrl(baseUrl, `/api/pets/${encodeURIComponent(slug)}/share`),
    `share data for ${slug}`,
    true,
  );
  if (response?.error === "not_found") {
    throw new Error(`Pet not found in gallery: ${slug}`);
  }
  if (!response?.pet || !response?.share) {
    throw new Error(`Share response for ${slug} is malformed.`);
  }
  return response;
}

async function fetchJson(fetchImpl, url, label, allowNotFound = false) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    if (allowNotFound && response.status === 404) {
      return response.json();
    }
    throw new Error(`Failed to fetch ${label}: HTTP ${response.status}`);
  }
  return response.json();
}

function normalizeQuery(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const query = value.replace(/\s+/g, " ").trim().slice(0, 120);
  return query || undefined;
}

function normalizeKind(value) {
  if (value == null || value === "" || value === "all") {
    return "all";
  }
  if (typeof value !== "string" || !PET_KINDS.has(value)) {
    throw new Error(`Invalid pet kind: ${String(value)}`);
  }
  return value;
}

function normalizeList(value) {
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20);
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean)
      .slice(0, 20);
  }
  return [];
}

function normalizeLimit(value) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value.trim() || DEFAULT_LIMIT)
        : DEFAULT_LIMIT;

  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }

  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed)));
}

function readSlug(value) {
  const slug = typeof value === "string" ? value.trim() : "";
  if (!SAFE_SLUG.test(slug)) {
    throw new Error("Invalid pet slug.");
  }
  return slug;
}

function derivePetAssetUrl(spritesheetUrl, filename) {
  try {
    const url = new URL(spritesheetUrl);
    const match = url.pathname.match(/^(.*\/api\/assets\/[^/]+)\/spritesheet\.(?:webp|png)$/);
    if (!match) {
      return null;
    }
    url.pathname = `${match[1]}/${filename}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function buildPublicUrl(baseUrl, pathname, searchParams) {
  const url = new URL(normalizeBaseUrl(baseUrl));
  const basePath = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}${pathname}`.replace(/\/{2,}/g, "/");
  url.search = searchParams ? searchParams.toString() : "";
  url.hash = "";
  return url.toString();
}

function escapeMarkdownAlt(value) {
  return value.replace(/[[\]\\]/g, "\\$&");
}

function escapeHtmlAttribute(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toolResult(structuredContent) {
  return {
    structuredContent,
    content: [
      {
        type: "text",
        text: JSON.stringify(structuredContent, null, 2),
      },
    ],
  };
}

async function runTool(load) {
  try {
    return toolResult(await load());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      structuredContent: {
        error: {
          code: errorCodeFromMessage(message),
          message,
        },
      },
      content: [
        {
          type: "text",
          text: message,
        },
      ],
      isError: true,
    };
  }
}

function errorCodeFromMessage(message) {
  if (message === "Invalid pet slug.") {
    return "invalid_argument";
  }
  if (message.startsWith("Pet not found in gallery:")) {
    return "not_found";
  }
  return "internal_error";
}
