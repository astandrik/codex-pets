import { markdownResponse } from "@/lib/agent-markdown";
import { toPublicUrl } from "@/lib/base-path";

export const runtime = "nodejs";

export function GET(): Response {
  return markdownResponse(`
# Codex Pets vs OpenPets

OpenPets is a desktop pet app for AI coding assistants. Codex Pets focuses on a moderated, agent-readable registry of downloadable Codex pet packs with stable package, API, and MCP discovery.

## Primary difference

OpenPets documents a local-first desktop app, MCP server, CLI, and assistant integrations for showing agent status on the user's desktop. Codex Pets is not a desktop status app; it is a public registry and package surface for Codex-compatible pet packs that agents can search, cite, install, and share.

## When to choose Codex Pets

- You need downloadable Codex pet pack assets and stable slugs.
- You want OpenAPI, llms.txt, markdown, JSON, TOON, and MCP discovery.
- You need README badge, animated card, iframe, or install snippets.
- You want a moderated public gallery that agents can cite directly.

## Links

- Gallery: ${toPublicUrl("/")}
- Agent access: ${toPublicUrl("/agents")}
- Best Codex pets guide: ${toPublicUrl("/guides/best-codex-pets-for-ai-coding-agents")}
`);
}
