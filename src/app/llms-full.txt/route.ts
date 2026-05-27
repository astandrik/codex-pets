import { toPublicUrl } from "@/lib/base-path";
import { AGENT_WHEN_TO_USE_GUIDANCE } from "@/lib/agent-markdown";
import { listApprovedPets } from "@/lib/pets/repository";
import { PET_SHEET } from "@/lib/pets/types";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LISTED_PETS = 100;

export async function GET(): Promise<Response> {
  const pets = await listApprovedPets();
  const listedPets = pets.slice(0, MAX_LISTED_PETS);
  const generatedAt = new Date().toISOString();
  const petLines = listedPets.map((pet) => {
    const author =
      pet.ownerProfileSlug && pet.ownerName
        ? ` by [${formatLinkText(pet.ownerName)}](${toPublicUrl(`/users/${pet.ownerProfileSlug}`)})`
        : "";
    const tags =
      pet.tags.length > 0
        ? ` Tags: ${pet.tags.map(formatInlineText).join(", ")}.`
        : "";

    return `- [${formatLinkText(pet.displayName)}](${toPublicUrl(`/pets/${pet.slug}`)}): Approved ${pet.kind} Codex pet pack${author}.${tags}`;
  });

  const omittedNote =
    pets.length > listedPets.length
      ? `\nThe approved pet list is truncated to ${MAX_LISTED_PETS} entries. Use ${toPublicUrl("/api/manifest")} for the full list.`
      : "";

  return new Response(
    [
      `# ${SITE_NAME} full LLM context`,
      "",
      `> ${SITE_DESCRIPTION}`,
      "",
      `Generated at ${generatedAt}.`,
      "",
      "## Product",
      "",
      "Codex Pets is a moderated community registry for downloadable Codex pet packs. Each approved pet has a public detail page, a package ZIP, pet.json metadata, a spritesheet atlas, share snippets, and install instructions.",
      `Pet spritesheets use an ${PET_SHEET.columns}x${PET_SHEET.rows} atlas at ${PET_SHEET.width}x${PET_SHEET.height}.`,
      "The public agent contract is read-oriented: agents can search approved pets, fetch one pet, generate install guidance, and discover the pet request workflow.",
      "",
      "## Developer resources",
      "",
      `- [Developer portal](${toPublicUrl("/developers")}): Codex Pets Developer Portal with links to API docs, OpenAPI, MCP, and auth notes.`,
      `- [API docs](${toPublicUrl("/docs/api")}): Codex Pets API docs for public JSON, TOON, MCP, request, and submission routes.`,
      `- [Markdown homepage](${toPublicUrl("/index.md")}): Canonical markdown fallback for the site root.`,
      `- [Markdown about page](${toPublicUrl("/about.md")}): Product description, authority notes, and Wikipedia/Wikidata follow-up guidance.`,
      `- [Markdown agent access](${toPublicUrl("/agents.md")}): Agent connection quickstart and when-to-use guidance.`,
      `- [Markdown developer portal](${toPublicUrl("/developers.md")}): Developer resources in markdown.`,
      `- [Markdown API docs](${toPublicUrl("/docs/api.md")}): API docs in markdown.`,
      `- [Markdown MCP docs](${toPublicUrl("/mcp.md")}): MCP server and MCP App security notes.`,
      `- [Auth markdown](${toPublicUrl("/auth.md")}): Public auth and access notes for agents.`,
      `- [OpenAPI JSON](${toPublicUrl("/openapi.json")}): Canonical OpenAPI 3.1 specification.`,
      `- [OpenAPI JSON alias](${toPublicUrl("/api/openapi.json")}): Predictable API-prefixed OpenAPI URL.`,
      `- [Concise llms.txt](${toPublicUrl("/llms.txt")}): Short AI-readable map of the gallery and machine resources.`,
      `- [Developer scoped llms.txt](${toPublicUrl("/developers/llms.txt")}): Scoped developer resource map for API, OpenAPI, MCP, and auth discovery.`,
      `- [API scoped llms.txt](${toPublicUrl("/docs/llms.txt")}): Scoped API and MCP route map for agent callers.`,
      `- [Sitemap](${toPublicUrl("/sitemap.xml")}): Dynamic sitemap with public pages and approved pet pages.`,
      `- [MCP Registry metadata](${toPublicUrl("/server.json")}): Public MCP Registry server metadata.`,
      `- [Well-known MCP metadata](${toPublicUrl("/.well-known/mcp/server.json")}): Well-known MCP Registry metadata mirror.`,
      `- [Well-known MCP endpoint](${toPublicUrl("/.well-known/mcp")}): Well-known HTTP MCP discovery and POST alias.`,
      `- [MCP server card](${toPublicUrl("/.well-known/mcp/server-card.json")}): Tool instructions, resource links, and MCP App resource metadata.`,
      "",
      "## API reference",
      "",
      `- GET ${toPublicUrl("/api/manifest")}: approved pet manifest with page URLs, asset URLs, and install commands.`,
      `- GET ${toPublicUrl("/api/manifest.toon")}: TOON mirror of the approved pet manifest.`,
      `- GET ${toPublicUrl("/api/pets")}: search approved pets with q, kind=all|creature|object|character, and comma-separated tags.`,
      `- GET ${toPublicUrl("/api/pets.toon")}: TOON mirror of approved pet search.`,
      `- GET ${toPublicUrl("/api/pets/{slug}")}: public JSON detail for one approved pet.`,
      `- GET ${toPublicUrl("/api/pets/{slug}.toon")}: TOON detail for one approved pet.`,
      `- GET ${toPublicUrl("/api/tags")}: tag counts for approved pets.`,
      `- GET ${toPublicUrl("/api/tags.toon")}: TOON tag counts for approved pets.`,
      `- GET ${toPublicUrl("/api/pets/{slug}/share")}: sanitized install, badge, card, and embed snippets.`,
      `- GET ${toPublicUrl("/api/pets/{slug}/install")}: read-only install instructions; does not increment install counters.`,
      `- POST ${toPublicUrl("/api/generation-requests")}: create a public pet generation request from JSON or multipart form data.`,
      `- POST ${toPublicUrl("/api/submissions/register")}: submit a pet pack for moderation using multipart form data.`,
      `- POST ${toPublicUrl("/mcp")}: Streamable HTTP MCP JSON-RPC endpoint for read-only tools.`,
      `- POST ${toPublicUrl("/.well-known/mcp")}: Well-known Streamable HTTP MCP JSON-RPC alias.`,
      "",
      "## Authentication and access",
      "",
      "- Public read endpoints do not require authentication.",
      "- AppSessionCookie is the optional app-session cookie used by browser account flows and signed-in request attribution.",
      "- ProxyBasic is supported as a deployment auth mode behind trusted reverse proxies.",
      "- OAuth 2.0 is not currently supported by Codex Pets.",
      "- Admin, account, moderation, delete, and private owner routes are not part of the public agent contract.",
      "- Public JSON and MCP outputs are sanitized to avoid private contact email fields.",
      "- JSON error responses include error, code, message, and when useful hint or field.",
      "",
      AGENT_WHEN_TO_USE_GUIDANCE.trim(),
      "",
      "## Quickstart examples",
      "",
      "```bash",
      `curl -s ${toPublicUrl("/api/manifest")}`,
      `curl -s "${toPublicUrl("/api/pets")}?q=space&kind=creature"`,
      `curl -s ${toPublicUrl("/api/pets/{slug}/install")}`,
      `codex mcp add codexPets --url ${toPublicUrl("/mcp")}`,
      "npx @astandrik/codex-pets install <slug>",
      "```",
      "",
      "## MCP tools",
      "",
      "- search_pets: search approved pets by query, kind, tags, author, and compatibility.",
      "- get_pet: fetch one sanitized approved pet card.",
      "- get_install_instructions: return CLI and manual install instructions.",
      "- get_badge_code: return README badge snippets.",
      "- get_embed_code: return iframe embed snippets.",
      "- get_card_code: return animated README card snippets.",
      "- get_pet_request_info: describe the public request workflow without creating a request.",
      "- search_pets and get_pet include MCP Apps UI metadata for ui://codex-pets/pet-browser.html when clients support MCP Apps.",
      "",
      "## Package format",
      "",
      "- Required files: pet.json and spritesheet.webp or spritesheet.png.",
      "- ZIP packages must contain pet.json and the spritesheet file at the root.",
      `- Atlas dimensions: ${PET_SHEET.width}x${PET_SHEET.height}, ${PET_SHEET.columns} columns, ${PET_SHEET.rows} rows.`,
      "- Install command format: npx @astandrik/codex-pets install <slug>.",
      "",
      "## Webhooks",
      "",
      "Webhooks are not currently available in Codex Pets. Use the public manifest, tags endpoint, sitemap, llms.txt, and llms-full.txt for polling and discovery.",
      "",
      "## Approved pet packs",
      "",
      petLines.length > 0
        ? petLines.join("\n")
        : "- No approved pet packs are currently listed.",
      omittedNote,
    ].join("\n"),
    {
      headers: {
        "Cache-Control": "public, max-age=60, s-maxage=300",
        "Content-Type": "text/plain; charset=utf-8",
      },
    },
  );
}

function formatLinkText(value: string): string {
  return formatInlineText(value).replace(/[[\]()]/g, "");
}

function formatInlineText(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 120);
}
