import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v4";

import {
  type AgentPet,
  createAgentPet,
  createAgentPets,
  filterAgentPets,
  normalizeAgentSearchFilters,
  readSafeAgentSlug,
} from "@/lib/pets/agent-dto";
import {
  type McpToolCallPayload,
  trackMcpToolCall,
} from "@/lib/metrics/yandex-measurement";
import { getApprovedPetBySlug, listApprovedPets } from "@/lib/pets/repository";

type McpToolName = McpToolCallPayload["tool"];
type SlugMcpToolName = Exclude<McpToolName, "search_pets">;

type McpToolResult = {
  structuredContent: Record<string, unknown>;
  content: Array<{ type: "text"; text: string }>;
  isError?: true;
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

const slugInputSchema = {
  slug: z.string().describe("Approved Codex pet slug."),
};

export function createCodexPetsMcpServer(): McpServer {
  const server = new McpServer({
    name: "codex-pets-registry",
    version: "0.1.0",
  });

  server.registerTool(
    "search_pets",
    {
      title: "Search Codex pets",
      description: "Search approved Codex pets by query, kind, tags, author, and compatibility.",
      inputSchema: {
        query: z.string().optional(),
        kind: z.enum(["all", "creature", "object", "character"]).optional(),
        tags: z.union([z.string(), z.array(z.string())]).optional(),
        author: z.string().optional(),
        compatibleWith: z.union([z.string(), z.array(z.string())]).optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      },
      annotations: READ_ONLY_TOOL,
    },
    async (args) => {
      try {
        const filters = normalizeAgentSearchFilters(args);
        const pets = await listApprovedPets({
          q: filters.query,
          kind: filters.kind,
        });
        const filteredPets = filterAgentPets(pets, filters);
        const agentPets = createAgentPets(filteredPets);

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

  server.registerTool(
    "get_pet",
    {
      title: "Get Codex pet",
      description: "Fetch one approved public Codex pet card by slug.",
      inputSchema: slugInputSchema,
      annotations: READ_ONLY_TOOL,
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
      description: "Return read-only install instructions for an approved Codex pet.",
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
      description: "Return Markdown and HTML README badge snippets for an approved Codex pet.",
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
      description: "Return iframe embed code for an approved Codex pet.",
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
      description: "Return Markdown and HTML animated card snippets for an approved Codex pet.",
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

  return server;
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
