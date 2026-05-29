import { oauthProtectedResourceResponse } from "@/lib/oauth-protected-resource";

export const runtime = "nodejs";

export function GET(): Response {
  return oauthProtectedResourceResponse("mcp");
}
