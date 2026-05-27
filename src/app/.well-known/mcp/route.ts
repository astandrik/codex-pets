import { buildMcpRegistryServerMetadata } from "@/lib/pets/mcp-registry";
import { POST as postMcp } from "@/app/mcp/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(buildMcpRegistryServerMetadata(), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}

export const POST = postMcp;
