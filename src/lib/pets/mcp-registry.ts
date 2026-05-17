import { toPublicUrl } from "@/lib/base-path";

export const MCP_REGISTRY_SCHEMA_URL =
  "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json";
export const MCP_REGISTRY_SERVER_NAME =
  "tech.ydb-qdrant.pets/codex-pets-ydb-qdrant";
export const MCP_REGISTRY_SERVER_TITLE = "Codex Pets Registry";
export const MCP_REGISTRY_SERVER_DESCRIPTION =
  "Search, preview, install community Codex pet packs, and discover the pet request flow.";
export const MCP_REGISTRY_SERVER_VERSION = "0.2.0";
export const MCP_REGISTRY_AUTH_RECORD =
  "v=MCPv1; k=ed25519; p=hf1UAXtYZTedJy3YtpjRYpB6IZRoZKEyzHJ+Wc/uxrc=";

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
