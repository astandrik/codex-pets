import { markdownResponse } from "@/lib/agent-markdown";
import { toPublicUrl } from "@/lib/base-path";

export const runtime = "nodejs";

export function GET(): Response {
  return markdownResponse(`
# Codex Pets MCP integration guide

Use the public read-only MCP server when an agent should search approved Codex pet packs, fetch one pack, or generate install and share snippets without changing site data.

## Connect

\`\`\`bash
codex mcp add codexPets --url ${toPublicUrl("/mcp")}
curl -s ${toPublicUrl("/.well-known/mcp/server-card.json")}
curl -s ${toPublicUrl("/api/manifest")}
\`\`\`

## Tool choices

- Use search_pets for vague style, tag, author, or category requests.
- Use get_pet when the agent already has an approved slug.
- Use get_install_instructions, get_badge_code, get_card_code, and get_embed_code for known-slug snippets.
- Use get_pet_request_info only to explain the public request workflow; it does not create private requests.

## Fallbacks

- OpenAPI: ${toPublicUrl("/openapi.json")}
- Developer llms.txt: ${toPublicUrl("/developers/llms.txt")}
- API llms.txt: ${toPublicUrl("/docs/llms.txt")}
- Full LLM context: ${toPublicUrl("/llms-full.txt")}
`);
}
