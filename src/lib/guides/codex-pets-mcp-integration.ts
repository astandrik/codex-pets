import { escapeMarkdownInlineText } from "@/lib/agent-markdown";
import { toPublicUrl } from "@/lib/base-path";
import {
  buildGuideArticleJsonLd,
  formatGuideByline,
  formatGuideDate,
  formatMarkdownDecisionTable,
  selectGuideExamplePets,
  type GuideDecisionRow,
  type GuideQueryExample,
} from "@/lib/guides/shared";
import type { PublicPet } from "@/lib/pets/types";

export type { GuideExamplePet as McpGuideExamplePet } from "@/lib/guides/shared";
export { selectGuideExamplePets as selectMcpGuideExamplePets } from "@/lib/guides/shared";

export const MCP_INTEGRATION_GUIDE_PATH =
  "/guides/codex-pets-mcp-integration-guide";
export const MCP_INTEGRATION_GUIDE_TITLE = "Codex Pets MCP integration guide";
export const MCP_INTEGRATION_GUIDE_DESCRIPTION =
  "Integrate AI coding agents with Codex Pets through the read-only MCP server, OpenAPI spec, public manifest, markdown docs, and package install commands.";
export const MCP_INTEGRATION_GUIDE_DATE_PUBLISHED = "2026-05-27";
export const MCP_INTEGRATION_GUIDE_DATE_MODIFIED = "2026-07-29";

export const METHODOLOGY_RUN_DATE = "2026-07-29";
const METHODOLOGY_RUN_DATE_LABEL = formatGuideDate(METHODOLOGY_RUN_DATE);

export const MCP_GUIDE_QUERY_EXAMPLES: GuideQueryExample[] = [
  {
    id: "manifest",
    title: "List every approved pet as JSON",
    command: `curl -s ${toPublicUrl("/api/manifest")}`,
    resultSummary: `Returned 146 approved pets when we ran it on ${METHODOLOGY_RUN_DATE_LABEL}.`,
    responseExcerpt: `{
  "generatedAt": "2026-07-29T21:16:26.515Z",
  "total": 146,
  "pets": [
    {
      "slug": "kesha",
      "displayName": "Kesha",
      "description": "A cheerful tan-and-white Pembroke Welsh corgi …",
      "installCommand": "npx @astandrik/codex-pets install kesha"
    },
    "… 145 more approved pets …"
  ]
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "search",
    title: "Search pets by vibe",
    command: `curl -s "${toPublicUrl("/api/pets")}?q=anime&pageSize=3"`,
    resultSummary: `Top match on ${METHODOLOGY_RUN_DATE_LABEL}: Anime Girl (anime-girl-3), a chibi anime pet. The MCP search_pets tool returns the same approved registry data.`,
    responseExcerpt: `{
  "total": 3,
  "pets": [
    {
      "slug": "anime-girl-3",
      "displayName": "Anime Girl",
      "description": "A slightly chibi anime girl pet …",
      "tags": ["anime", "chibi", "sweater-dress"],
      "downloadCount": 53
    },
    "… 2 more matches …"
  ]
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "install",
    title: "Get install instructions for a slug",
    command: `curl -s ${toPublicUrl("/api/pets/anime-girl-3/install")}`,
    resultSummary: `Returned CLI and manual install steps, including npx @astandrik/codex-pets install anime-girl-3 and the codex mcp add command.`,
    responseExcerpt: `{
  "slug": "anime-girl-3",
  "name": "Anime Girl",
  "install": {
    "command": "npx @astandrik/codex-pets install anime-girl-3",
    "codex": {
      "mcpServer": {
        "addCommand": "codex mcp add codexPets --url ${toPublicUrl("/mcp")}"
      }
    },
    "cursor": {
      "command": "npx @astandrik/codex-pets install anime-girl-3",
      "note": "…"
    },
    "claudeCode": {
      "command": "npx @astandrik/codex-pets install anime-girl-3",
      "note": "…"
    },
    "manual": { "steps": ["…"] }
  }
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
];

export const MCP_GUIDE_DECISION_ROWS: GuideDecisionRow[] = [
  {
    surface: "MCP server (POST /mcp)",
    useWhen:
      "The agent host supports MCP tool calls, such as Codex, Claude Code, or Cursor.",
    example: "search_pets, get_pet, get_install_instructions",
  },
  {
    surface: "OpenAPI + JSON routes",
    useWhen:
      "The agent only has plain HTTP access or needs a typed contract for codegen.",
    example: "GET /api/pets?q=anime, GET /openapi.json",
  },
  {
    surface: "llms.txt + markdown docs",
    useWhen:
      "The agent needs compact product context or docs in a single fetch.",
    example: "GET /llms-full.txt, GET /mcp.md",
  },
];

export function getMcpIntegrationGuideJsonLd(): Record<string, unknown> {
  return buildGuideArticleJsonLd({
    path: MCP_INTEGRATION_GUIDE_PATH,
    title: MCP_INTEGRATION_GUIDE_TITLE,
    description: MCP_INTEGRATION_GUIDE_DESCRIPTION,
    datePublished: MCP_INTEGRATION_GUIDE_DATE_PUBLISHED,
    dateModified: MCP_INTEGRATION_GUIDE_DATE_MODIFIED,
    type: "TechArticle",
  });
}

export function buildMcpIntegrationGuideMarkdown(pets: PublicPet[]): string {
  const examplePets = selectGuideExamplePets(pets);
  const exampleBlocks = MCP_GUIDE_QUERY_EXAMPLES.map((example) =>
    [
      `### ${example.title}`,
      "",
      `\`${example.command}\``,
      "",
      "```json",
      example.responseExcerpt,
      "```",
      "",
      `${escapeMarkdownInlineText(example.resultSummary)} (Run on ${formatGuideDate(example.runDate)}.)`,
    ].join("\n"),
  );
  const petLines = examplePets.map(
    (pet) =>
      `- [${escapeMarkdownInlineText(pet.displayName)}](${pet.pageUrl}): ${escapeMarkdownInlineText(pet.description)} Install: \`${pet.installCommand}\`.`,
  );

  return [
    `# ${MCP_INTEGRATION_GUIDE_TITLE}`,
    "",
    `> ${MCP_INTEGRATION_GUIDE_DESCRIPTION}`,
    "",
    formatGuideByline({
      datePublished: MCP_INTEGRATION_GUIDE_DATE_PUBLISHED,
      dateModified: MCP_INTEGRATION_GUIDE_DATE_MODIFIED,
    }),
    "",
    "## How we tested",
    "",
    `We ran these reproducible checks against the production deployment on ${METHODOLOGY_RUN_DATE_LABEL}. Each one uses only public read-only routes, so you can repeat them verbatim.`,
    "",
    ...exampleBlocks,
    "",
    "## Which surface should your agent use?",
    "",
    formatMarkdownDecisionTable(MCP_GUIDE_DECISION_ROWS),
    "",
    "## Connect",
    "",
    "```bash",
    `codex mcp add codexPets --url ${toPublicUrl("/mcp")}`,
    `curl -s ${toPublicUrl("/.well-known/mcp/server-card.json")}`,
    `curl -s ${toPublicUrl("/api/manifest")}`,
    "```",
    "",
    "## Tool choices",
    "",
    "- Use search_pets for a vague style, tag, or category request.",
    "- Use get_pet when the agent already has an approved slug.",
    "- Use snippet tools for install instructions, README badges, animated cards, and iframe embeds.",
    "- Use get_pet_request_info only to explain the public request form. It does not create private requests.",
    "",
    "## Example pets from this guide",
    "",
    ...(petLines.length > 0
      ? petLines
      : ["- No approved pets are listed yet."]),
    "",
    "## Fallbacks",
    "",
    `- OpenAPI: ${toPublicUrl("/openapi.json")}`,
    `- Developer llms.txt: ${toPublicUrl("/developers/llms.txt")}`,
    `- API llms.txt: ${toPublicUrl("/docs/llms.txt")}`,
    `- Full LLM context: ${toPublicUrl("/llms-full.txt")}`,
    "",
    "## Links",
    "",
    `- Gallery: ${toPublicUrl("/")}`,
    `- Agent access: ${toPublicUrl("/agents")}`,
    `- Best Codex pets guide: ${toPublicUrl("/guides/best-codex-pets-for-ai-coding-agents")}`,
  ].join("\n");
}
