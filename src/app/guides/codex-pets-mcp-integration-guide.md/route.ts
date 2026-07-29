import { unstable_cache } from "next/cache";

import { markdownResponse } from "@/lib/agent-markdown";
import {
  buildMcpIntegrationGuideMarkdown,
  MCP_INTEGRATION_GUIDE_PATH,
} from "@/lib/guides/codex-pets-mcp-integration";
import { listApprovedPets } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPets(),
  [
    "mcp-integration-guide-markdown",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

export async function GET(): Promise<Response> {
  return markdownResponse(
    buildMcpIntegrationGuideMarkdown(await getApprovedPetsSnapshot()),
    { canonicalPath: MCP_INTEGRATION_GUIDE_PATH },
  );
}
