import { buildPricingMarkdown, markdownResponse } from "@/lib/agent-markdown";

export const runtime = "nodejs";

export function GET(): Response {
  return markdownResponse(buildPricingMarkdown(), { canonicalPath: "/pricing" });
}
