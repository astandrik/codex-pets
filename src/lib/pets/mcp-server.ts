import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod/v4";

import { getPublicOrigin, toPublicUrl } from "@/lib/base-path";
import {
  type AgentPet,
  createAgentPet,
  createAgentPets,
  normalizeAgentSearchFilters,
  readSafeAgentSlug,
} from "@/lib/pets/agent-dto";
import {
  type McpToolCallPayload,
  trackMcpToolCall,
} from "@/lib/metrics/yandex-measurement";
import { getApprovedPetBySlug } from "@/lib/pets/repository";
import { MCP_REGISTRY_SERVER_VERSION } from "@/lib/pets/mcp-registry";
import { searchApprovedPets } from "@/lib/pets/search-runtime";

type McpToolName = McpToolCallPayload["tool"];
type SlugMcpToolName = Exclude<
  McpToolName,
  "search_pets" | "get_pet_request_info"
>;

type McpToolResult = {
  structuredContent: Record<string, unknown>;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
};

type McpAppCsp = {
  connectDomains: string[];
  resourceDomains: string[];
  baseUriDomains: string[];
};

type ReadAgentPetResult = {
  ok: true;
  slug: string;
  pet: AgentPet;
} | {
  ok: false;
  code: "invalid_argument" | "not_found";
  message: string;
  slug?: string;
};

const READ_ONLY_TOOL = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const MCP_APP_RESOURCE_URI = "ui://codex-pets/pet-browser.html";
const MCP_APP_META = {
  ui: {
    resourceUri: MCP_APP_RESOURCE_URI,
  },
} as const;

const slugInputSchema = {
  slug: z.string().describe("Exact slug of an approved public Codex pet."),
};

const searchInputSchema = {
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

export function createCodexPetsMcpServer(): McpServer {
  const server = new McpServer({
    name: "codex-pets-registry",
    version: MCP_REGISTRY_SERVER_VERSION,
  });

  registerCodexPetsAppResource(server);

  registerAppTool(
    server,
    "search_pets",
    {
      title: "Search Codex pets",
      description:
        "Use to discover one or more approved public Codex pet packs by query, kind, tags, author, or Codex compatibility. Prefer this over get_pet when you do not already have an exact slug or need multiple candidates. Do not use for private generation requests or known-slug install/share snippets; use get_pet_request_info or a slug-specific get_* tool instead.",
      inputSchema: searchInputSchema,
      annotations: READ_ONLY_TOOL,
      _meta: MCP_APP_META,
    },
    async (args) => {
      try {
        const filters = normalizeAgentSearchFilters(args);
        const compatibleWithCodex = filters.compatibleWith.every(
          (value) => value === "codex",
        );
        const pets = compatibleWithCodex
          ? (
              await searchApprovedPets({
                q: filters.query,
                kind: filters.kind,
                tags: filters.tags,
                author: filters.author,
                limit: filters.limit,
              })
            ).pets
          : [];
        const agentPets = createAgentPets(pets);

        await trackMcpToolCall({
          tool: "search_pets",
          status: "success",
          kind: filters.kind,
          hasQuery: Boolean(filters.query),
          resultCount: agentPets.length,
          limit: filters.limit,
        });

        return toolResult({
          total: agentPets.length,
          limit: filters.limit,
          pets: agentPets,
        });
      } catch (error) {
        await trackMcpToolCall({
          tool: "search_pets",
          status: "error",
        });
        throw error;
      }
    },
  );

  registerAppTool(
    server,
    "get_pet",
    {
      title: "Get Codex pet",
      description:
        "Use when you already have an exact approved pet slug and need the sanitized public pet card, asset URLs, page URL, and install command for that one pet. Use search_pets first when you only have a name/query or need multiple results. Do not use for focused install, badge, embed, card, or request workflow details; use the matching get_* tool instead.",
      inputSchema: slugInputSchema,
      annotations: READ_ONLY_TOOL,
      _meta: MCP_APP_META,
    },
    async (args) => {
      return handleApprovedPetTool("get_pet", args.slug, (pet) => ({
        pet,
      }));
    },
  );

  server.registerTool(
    "get_install_instructions",
    {
      title: "Get install instructions",
      description:
        "Use for a known approved pet slug when the user wants CLI or manual install instructions. Do not use to search for pets or inspect general metadata; use search_pets or get_pet instead. This tool is read-only and does not increment install or download counters.",
      inputSchema: slugInputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => {
      return handleApprovedPetTool(
        "get_install_instructions",
        args.slug,
        (pet) => ({
          slug: pet.slug,
          name: pet.name,
          install: pet.install,
        }),
      );
    },
  );

  server.registerTool(
    "get_badge_code",
    {
      title: "Get README badge code",
      description:
        "Use for a known approved pet slug when the user needs README badge Markdown, HTML, or SVG URL. Do not use for animated README cards, website iframe embeds, install instructions, or pet discovery; use get_card_code, get_embed_code, get_install_instructions, or search_pets instead.",
      inputSchema: slugInputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => {
      return handleApprovedPetTool("get_badge_code", args.slug, (pet) => ({
        slug: pet.slug,
        name: pet.name,
        badge: pet.badge,
      }));
    },
  );

  server.registerTool(
    "get_embed_code",
    {
      title: "Get website embed code",
      description:
        "Use for a known approved pet slug when the user needs website iframe embed HTML or an embed URL. Do not use for README badges/cards, install instructions, or pet discovery; use get_badge_code, get_card_code, get_install_instructions, or search_pets instead.",
      inputSchema: slugInputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => {
      return handleApprovedPetTool("get_embed_code", args.slug, (pet) => ({
        slug: pet.slug,
        name: pet.name,
        embed: pet.embed,
      }));
    },
  );

  server.registerTool(
    "get_card_code",
    {
      title: "Get animated README card code",
      description:
        "Use for a known approved pet slug when the user needs animated README card Markdown, HTML, or GIF URL. Do not use for simple badges, website iframe embeds, install instructions, or pet discovery; use get_badge_code, get_embed_code, get_install_instructions, or search_pets instead.",
      inputSchema: slugInputSchema,
      annotations: READ_ONLY_TOOL,
    },
    async (args) => {
      return handleApprovedPetTool("get_card_code", args.slug, (pet) => ({
        slug: pet.slug,
        name: pet.name,
        card: pet.card,
      }));
    },
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
    async () => {
      await trackMcpToolCall({
        tool: "get_pet_request_info",
        status: "success",
      });
      return toolResult(buildPetRequestInfo());
    },
  );

  return server;
}

function registerCodexPetsAppResource(server: McpServer): void {
  const csp = buildMcpAppCsp();

  registerAppResource(
    server,
    "Codex Pets browser",
    MCP_APP_RESOURCE_URI,
    {
      description: "Interactive Codex Pets search and detail result view.",
      _meta: {
        ui: {
          prefersBorder: true,
          csp,
        },
      },
    },
    async () => ({
      contents: [
        {
          uri: MCP_APP_RESOURCE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: buildCodexPetsAppHtml(),
          _meta: {
            ui: {
              prefersBorder: true,
              csp,
            },
          },
        },
      ],
    }),
  );
}

function buildMcpAppCsp(): McpAppCsp {
  const origin = getPublicOrigin();
  return {
    connectDomains: [origin],
    resourceDomains: [origin],
    baseUriDomains: [origin],
  };
}

function buildCodexPetsAppHtml(): string {
  const origin = getPublicOrigin();
  const csp = [
    "default-src 'none'",
    `base-uri ${origin}`,
    `connect-src ${origin}`,
    `form-action ${origin}`,
    `img-src ${origin} data:`,
    `script-src ${origin}`,
    `style-src ${origin} 'unsafe-inline'`,
  ].join("; ");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <title>Codex Pets</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 16px; background: Canvas; color: CanvasText; }
    main { display: grid; gap: 12px; }
    h1 { margin: 0; font-size: 18px; }
    p { margin: 0; color: color-mix(in srgb, CanvasText 74%, transparent); line-height: 1.5; }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    a { color: LinkText; font-weight: 650; }
  </style>
</head>
<body>
  <main>
    <h1>Codex Pets</h1>
    <p>Search approved Codex pet packs, inspect one pet, and hand users install, badge, card, or embed snippets from the read-only MCP server.</p>
    <div class="actions">
      <a href="${toPublicUrl("/")}">Browse gallery</a>
      <a href="${toPublicUrl("/developers")}">Developer resources</a>
      <a href="${toPublicUrl("/llms.txt")}">llms.txt</a>
    </div>
  </main>
</body>
</html>`;
}

function buildPetRequestInfo(): Record<string, unknown> {
  return {
    request: {
      pageUrl: toPublicRequestUrl(),
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

function toPublicRequestUrl(): string {
  return toPublicUrl("/request");
}

async function handleApprovedPetTool(
  tool: SlugMcpToolName,
  slugInput: unknown,
  buildContent: (pet: AgentPet) => Record<string, unknown>,
): Promise<McpToolResult> {
  try {
    const result = await readApprovedAgentPet(slugInput);
    if (!result.ok) {
      await trackMcpToolCall({
        tool,
        status: result.code,
        ...(result.slug ? { slug: result.slug } : {}),
      });
      return toolError(result.code, result.message);
    }

    await trackMcpToolCall({
      tool,
      status: "success",
      slug: result.slug,
    });
    return toolResult(buildContent(result.pet));
  } catch (error) {
    await trackMcpToolCall({
      tool,
      status: "error",
    });
    throw error;
  }
}

async function readApprovedAgentPet(
  slugInput: unknown,
): Promise<ReadAgentPetResult> {
  const slug = readSafeAgentSlug(slugInput);
  if (!slug) {
    return {
      ok: false,
      code: "invalid_argument",
      message: "Invalid pet slug.",
    };
  }

  const pet = await getApprovedPetBySlug(slug);
  if (!pet) {
    return {
      ok: false,
      code: "not_found",
      message: "Approved pet not found.",
      slug,
    };
  }

  return {
    ok: true,
    slug,
    pet: createAgentPet(pet),
  };
}

function toolResult(structuredContent: Record<string, unknown>): McpToolResult {
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

function toolError(code: string, message: string): McpToolResult {
  const structuredContent = {
    error: {
      code,
      message,
    },
  };

  return {
    isError: true,
    ...toolResult(structuredContent),
  };
}
