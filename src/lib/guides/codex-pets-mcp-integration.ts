import { escapeMarkdownInlineText } from "@/lib/agent-markdown";
import { toPublicUrl } from "@/lib/base-path";
import {
  buildGuideArticleJsonLd,
  formatGuideByline,
  formatGuideDate,
  formatMarkdownDecisionTable,
  type GuideDecisionRow,
  type GuideQueryExample,
} from "@/lib/guides/shared";
import { buildPetInstallCommand } from "@/lib/pets/install-command";
import type { PublicPet } from "@/lib/pets/types";

export const MCP_INTEGRATION_GUIDE_PATH =
  "/guides/codex-pets-mcp-integration-guide";
export const MCP_INTEGRATION_GUIDE_TITLE = "Codex Pets MCP integration guide";
export const MCP_INTEGRATION_GUIDE_DESCRIPTION =
  "Integrate AI coding agents with Codex Pets through the read-only MCP server, OpenAPI spec, public manifest, markdown docs, and package install commands.";
export const MCP_INTEGRATION_GUIDE_DATE_PUBLISHED = "2026-05-27";
export const MCP_INTEGRATION_GUIDE_DATE_MODIFIED = "2026-07-29";

const METHODOLOGY_RUN_DATE = "2026-07-29";
const METHODOLOGY_RUN_DATE_LABEL = formatGuideDate(METHODOLOGY_RUN_DATE);

export const MCP_GUIDE_QUERY_EXAMPLES: GuideQueryExample[] = [
  {
    id: "manifest",
    title: "List every approved pet as JSON",
    command: `curl -s ${toPublicUrl("/api/manifest")}`,
    resultSummary: `Returned 146 approved pets when we ran it on ${METHODOLOGY_RUN_DATE_LABEL}.`,
    runDate: METHODOLOGY_RUN_DATE,
    screenshot: {
      path: "/guides/mcp-integration/manifest-json.png",
      alt: "JSON manifest response listing approved Codex pets",
      width: 1200,
      height: 847,
    },
  },
  {
    id: "search",
    title: "Search pets by vibe",
    command: `curl -s "${toPublicUrl("/api/pets")}?q=anime&pageSize=3"`,
    resultSummary: `Top match on ${METHODOLOGY_RUN_DATE_LABEL}: Anime Girl (anime-girl-3), a chibi anime pet. The MCP search_pets tool returns the same approved registry data.`,
    runDate: METHODOLOGY_RUN_DATE,
    screenshot: {
      path: "/guides/mcp-integration/search-anime-json.png",
      alt: "Search JSON response for the anime query",
      width: 1200,
      height: 847,
    },
  },
  {
    id: "install",
    title: "Get install instructions for a slug",
    command: `curl -s ${toPublicUrl("/api/pets/anime-girl-3/install")}`,
    resultSummary: `Returned CLI and manual install steps, including npx @astandrik/codex-pets install anime-girl-3 and the codex mcp add command.`,
    runDate: METHODOLOGY_RUN_DATE,
    screenshot: {
      path: "/guides/mcp-integration/pet-install.png",
      alt: "Pet page install section for the Anime Girl pet",
      width: 1145,
      height: 45,
    },
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

export type McpGuideExamplePet = {
  slug: string;
  displayName: string;
  description: string;
  pageUrl: string;
  installCommand: string;
};

export function selectMcpGuideExamplePets(
  pets: PublicPet[],
  limit = 3,
): McpGuideExamplePet[] {
  return pets
    .toSorted(compareGuidePets)
    .slice(0, limit)
    .map((pet) => ({
      slug: pet.slug,
      displayName: pet.displayName,
      description: pet.description,
      pageUrl: toPublicUrl(`/pets/${encodeURIComponent(pet.slug)}`),
      installCommand: buildPetInstallCommand(pet.slug),
    }));
}

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
  const examplePets = selectMcpGuideExamplePets(pets);
  const exampleBlocks = MCP_GUIDE_QUERY_EXAMPLES.map((example) =>
    [
      `### ${example.title}`,
      "",
      `\`${example.command}\``,
      "",
      `${escapeMarkdownInlineText(example.resultSummary)} (Run on ${formatGuideDate(example.runDate)}.)`,
    ].join("\n"),
  );
  const petLines = examplePets.map(
    (pet) =>
      `- [${escapeMarkdownInlineText(pet.displayName)}](/pets/${encodeURIComponent(
        pet.slug,
      )}): ${escapeMarkdownInlineText(pet.description)} Install: \`${pet.installCommand}\`.`,
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

function compareGuidePets(left: PublicPet, right: PublicPet): number {
  return (
    popularityScore(right) - popularityScore(left) ||
    dateScore(right.approvedAt ?? right.createdAt) -
      dateScore(left.approvedAt ?? left.createdAt) ||
    left.displayName.localeCompare(right.displayName)
  );
}

function popularityScore(pet: PublicPet): number {
  return pet.likeCount + pet.downloadCount + pet.installCount;
}

function dateScore(value: string): number {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}
