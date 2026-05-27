import { toPublicUrl } from "@/lib/base-path";

export const MCP_REGISTRY_SCHEMA_URL =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
export const MCP_REGISTRY_SERVER_NAME =
  "tech.ydb-qdrant.pets/codex-pets-ydb-qdrant";
export const MCP_REGISTRY_SERVER_TITLE = "Codex Pets Registry";
export const MCP_REGISTRY_SERVER_DESCRIPTION =
  "Search, preview, install community Codex pet packs, and discover the pet request flow.";
export const MCP_REGISTRY_SERVER_VERSION = "1.0.0";
export const MCP_REGISTRY_AUTH_RECORD =
  "v=MCPv1; k=ed25519; p=hf1UAXtYZTedJy3YtpjRYpB6IZRoZKEyzHJ+Wc/uxrc=";
export const GLAMA_CONNECTOR_SCHEMA_URL =
  "https://glama.ai/mcp/schemas/connector.json";
export const GLAMA_CONNECTOR_MAINTAINER_EMAIL = "astandrik@gmail.com";

export type McpRegistryServerMetadata = {
  $schema: string;
  name: string;
  title: string;
  description: string;
  version: string;
  websiteUrl: string;
  remotes: Array<{
    type: "streamable-http";
    url: string;
  }>;
};

export type GlamaConnectorClaimMetadata = {
  $schema: string;
  maintainers: Array<{
    email: string;
  }>;
};

export type McpServerCard = {
  name: string;
  description: string;
  version: string;
  serverUrl: string;
  endpoint: string;
  instructions: string;
  tools: Array<{
    name: string;
    description: string;
  }>;
  resources: Array<{
    title: string;
    url: string;
    type: string;
  }>;
};

export function buildMcpRegistryServerMetadata(): McpRegistryServerMetadata {
  return {
    $schema: MCP_REGISTRY_SCHEMA_URL,
    name: MCP_REGISTRY_SERVER_NAME,
    title: MCP_REGISTRY_SERVER_TITLE,
    description: MCP_REGISTRY_SERVER_DESCRIPTION,
    version: MCP_REGISTRY_SERVER_VERSION,
    websiteUrl: toPublicUrl("/"),
    remotes: [
      {
        type: "streamable-http",
        url: toPublicUrl("/mcp"),
      },
    ],
  };
}

export function buildGlamaConnectorClaimMetadata(): GlamaConnectorClaimMetadata {
  return {
    $schema: GLAMA_CONNECTOR_SCHEMA_URL,
    maintainers: [
      {
        email: GLAMA_CONNECTOR_MAINTAINER_EMAIL,
      },
    ],
  };
}

export function buildMcpServerCard(): McpServerCard {
  const serverUrl = toPublicUrl("/mcp");
  return {
    name: MCP_REGISTRY_SERVER_TITLE,
    description: MCP_REGISTRY_SERVER_DESCRIPTION,
    version: MCP_REGISTRY_SERVER_VERSION,
    serverUrl,
    endpoint: serverUrl,
    instructions:
      "Use this read-only MCP server to search approved Codex pet packs, fetch one approved pet, and generate install, badge, card, or embed snippets. Do not use it for private requests, account actions, moderation, deletes, downloads, or metrics mutations.",
    tools: [
      {
        name: "search_pets",
        description: "Search approved public Codex pet packs.",
      },
      {
        name: "get_pet",
        description: "Fetch one sanitized approved pet card.",
      },
      {
        name: "get_install_instructions",
        description: "Return CLI and manual install instructions.",
      },
      {
        name: "get_badge_code",
        description: "Return README badge snippets.",
      },
      {
        name: "get_embed_code",
        description: "Return iframe embed snippets.",
      },
      {
        name: "get_card_code",
        description: "Return animated README card snippets.",
      },
      {
        name: "get_pet_request_info",
        description: "Describe the public new-pet request workflow.",
      },
    ],
    resources: [
      {
        title: "llms.txt",
        url: toPublicUrl("/llms.txt"),
        type: "text/plain",
      },
      {
        title: "OpenAPI JSON",
        url: toPublicUrl("/openapi.json"),
        type: "application/json",
      },
      {
        title: "MCP Registry metadata",
        url: toPublicUrl("/server.json"),
        type: "application/json",
      },
      {
        title: "MCP App pet browser",
        url: "ui://codex-pets/pet-browser.html",
        type: "text/html;profile=mcp-app",
      },
    ],
  };
}
