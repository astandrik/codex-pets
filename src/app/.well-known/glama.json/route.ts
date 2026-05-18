import { buildGlamaConnectorClaimMetadata } from "@/lib/pets/mcp-registry";

export const runtime = "nodejs";

export function GET(): Response {
  return Response.json(buildGlamaConnectorClaimMetadata(), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
    },
  });
}
