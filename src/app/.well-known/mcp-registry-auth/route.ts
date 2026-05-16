import { MCP_REGISTRY_AUTH_RECORD } from "@/lib/pets/mcp-registry";

export const runtime = "nodejs";

export function GET(): Response {
  return new Response(`${MCP_REGISTRY_AUTH_RECORD}\n`, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}
