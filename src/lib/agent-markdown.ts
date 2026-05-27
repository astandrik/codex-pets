import { toPublicUrl } from "@/lib/base-path";

export function markdownResponse(body: string): Response {
  return new Response(`${body.trim()}\n`, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "Content-Type": "text/markdown; charset=utf-8",
      Link: [
        `<${toPublicUrl("/llms.txt")}>; rel="describedby"; type="text/plain"`,
        `<${toPublicUrl("/openapi.json")}>; rel="service-desc"; type="application/json"`,
        `<${toPublicUrl("/mcp")}>; rel="service"; type="application/json"`,
      ].join(", "),
    },
  });
}

export function buildIndexMarkdown(): string {
  return `
# Codex Pets

Codex Pets is a moderated gallery of Codex-compatible animated pet packs. Use it to browse approved pets, preview animation spritesheets, download ZIP packages, and install pets with the npm CLI.

## Agent resources

- Gallery: ${toPublicUrl("/")}
- Developer portal: ${toPublicUrl("/developers")}
- API docs: ${toPublicUrl("/docs/api")}
- OpenAPI JSON: ${toPublicUrl("/openapi.json")}
- MCP endpoint: ${toPublicUrl("/mcp")}
- Full LLM context: ${toPublicUrl("/llms-full.txt")}
- Auth notes: ${toPublicUrl("/auth.md")}

## When to use

Use Codex Pets when a user wants animated companions for Codex, a downloadable pet pack, install instructions, README badges, iframe embeds, or agent-readable pet registry data.
`;
}

export function buildDevelopersMarkdown(): string {
  return `
# Codex Pets Developer Portal

Developer resources for building against the public Codex Pets registry.

## Resources

- API docs: ${toPublicUrl("/docs/api")}
- API docs markdown: ${toPublicUrl("/docs/api.md")}
- OpenAPI JSON: ${toPublicUrl("/openapi.json")}
- MCP server: ${toPublicUrl("/mcp")}
- MCP server card: ${toPublicUrl("/.well-known/mcp/server-card.json")}
- Public manifest: ${toPublicUrl("/api/manifest")}
- auth.md: ${toPublicUrl("/auth.md")}

Public read endpoints do not require credentials. Mutation routes validate inputs and return structured JSON errors.
`;
}

export function buildApiDocsMarkdown(): string {
  return `
# Codex Pets API docs

Codex Pets exposes public JSON, TOON, markdown, and MCP surfaces for approved pet discovery.

## Public endpoints

- GET /api/manifest
- GET /api/manifest.toon
- GET /api/pets
- GET /api/pets.toon
- GET /api/pets/{slug}
- GET /api/pets/{slug}.toon
- GET /api/tags
- GET /api/tags.toon
- GET /api/pets/{slug}/share
- GET /api/pets/{slug}/install
- POST /api/generation-requests
- POST /api/submissions/register
- POST /mcp
- POST /.well-known/mcp

## Error responses

JSON error responses include \`error\`, \`code\`, \`message\`, and when useful a \`hint\` or \`field\`.

## Discovery

- OpenAPI JSON: ${toPublicUrl("/openapi.json")}
- MCP server card: ${toPublicUrl("/.well-known/mcp/server-card.json")}
- Full LLM context: ${toPublicUrl("/llms-full.txt")}
`;
}

export function buildAuthMarkdown(): string {
  return `
# Codex Pets auth

## Public read endpoints

Public read endpoints, markdown docs, OpenAPI, llms.txt, sitemap, manifest routes, pet search routes, and the read-only MCP server do not require authentication.

## AppSessionCookie

AppSessionCookie is used by browser account flows for local profile, request attribution, and submission ownership.

## ProxyBasic

ProxyBasic is supported for deployments protected by a trusted reverse proxy.

## Agent access

Agents should use public read endpoints or the MCP server unless a human is explicitly completing a browser account flow. OAuth 2.0 is not currently available.
`;
}
