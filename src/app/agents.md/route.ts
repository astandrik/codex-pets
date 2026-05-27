import { buildAgentsMarkdown, markdownResponse } from "@/lib/agent-markdown";

export const runtime = "nodejs";

export function GET(): Response {
  return markdownResponse(buildAgentsMarkdown());
}
