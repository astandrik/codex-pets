import { markdownResponse } from "@/lib/agent-markdown";
import { toPublicUrl } from "@/lib/base-path";

export const runtime = "nodejs";

export function GET(): Response {
  return markdownResponse(`
# Codex Pets vs VS Code Pets

VS Code Pets is a popular editor extension category leader. Codex Pets focuses on Codex-compatible downloadable pet packs and agent-readable registry access.

## When to choose Codex Pets

- You want pet packs designed for Codex rather than a VS Code extension.
- You need public manifest, OpenAPI, llms.txt, or MCP discovery.
- You want downloadable ZIP packages with pet.json and spritesheet assets.
- You want README badge, card, or iframe share snippets for approved pets.

## Agent-readiness difference

Codex Pets exposes its registry through MCP, JSON, TOON, OpenAPI, sitemap, llms.txt, and llms-full.txt. That lets coding agents inspect approved pets and produce install instructions without scraping a visual gallery.

## Links

- Gallery: ${toPublicUrl("/")}
- Developer resources: ${toPublicUrl("/developers")}
- Best Codex pets guide: ${toPublicUrl("/guides/best-codex-pets-for-ai-coding-agents")}
`);
}
