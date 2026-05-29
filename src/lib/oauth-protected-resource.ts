import { toPublicUrl } from "@/lib/base-path";

type ProtectedResourceKind = "site" | "mcp";

export type OAuthProtectedResourceMetadata = {
  resource: string;
  resource_name: string;
  service_documentation: string;
  policy_uri: string;
  terms_of_service: string;
  oauth_unsupported: true;
  scopes_supported: string[];
  bearer_methods_supported: string[];
};

export function buildOAuthProtectedResourceMetadata(
  kind: ProtectedResourceKind,
): OAuthProtectedResourceMetadata {
  return {
    resource: kind === "mcp" ? toPublicUrl("/mcp") : toPublicUrl("/"),
    resource_name: "Codex Pets",
    service_documentation:
      kind === "mcp" ? toPublicUrl("/mcp.md") : toPublicUrl("/developers"),
    policy_uri: toPublicUrl("/terms"),
    terms_of_service: toPublicUrl("/terms"),
    oauth_unsupported: true,
    scopes_supported: [],
    bearer_methods_supported: [],
  };
}

export function oauthProtectedResourceResponse(
  kind: ProtectedResourceKind,
): Response {
  return Response.json(buildOAuthProtectedResourceMetadata(kind), {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Content-Type": "application/json",
    },
  });
}
