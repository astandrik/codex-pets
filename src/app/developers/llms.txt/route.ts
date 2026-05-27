import {
  buildDeveloperLlmsTxt,
  plainTextResponse,
} from "@/lib/agent-markdown";

export const runtime = "nodejs";

export function GET(): Response {
  return plainTextResponse(buildDeveloperLlmsTxt());
}
