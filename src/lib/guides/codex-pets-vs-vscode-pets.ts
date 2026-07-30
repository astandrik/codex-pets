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

export const VS_VSCODE_PETS_GUIDE_PATH = "/guides/codex-pets-vs-vscode-pets";
export const VS_VSCODE_PETS_GUIDE_TITLE = "Codex Pets vs VS Code Pets";
export const VS_VSCODE_PETS_GUIDE_DESCRIPTION =
  "A maintainer-written comparison of Codex Pets and the VS Code Pets extension: what each one actually does, reproducible registry queries, and a decision table for agent hosts.";
export const VS_VSCODE_PETS_DATE_PUBLISHED = "2026-05-26";
export const VS_VSCODE_PETS_DATE_MODIFIED = "2026-07-30";

export const METHODOLOGY_RUN_DATE = "2026-07-30";
const METHODOLOGY_RUN_DATE_LABEL = formatGuideDate(METHODOLOGY_RUN_DATE);

export const VS_VSCODE_PETS_QUERY_EXAMPLES: GuideQueryExample[] = [
  {
    id: "manifest",
    title: "List every approved pet as JSON",
    command: `curl -s ${toPublicUrl("/api/manifest")}`,
    resultSummary: `Returned 146 approved pets when we ran it on ${METHODOLOGY_RUN_DATE_LABEL}. Each entry carries the petJsonUrl, spritesheetUrl, and zipUrl a pack needs.`,
    responseExcerpt: `{
  "generatedAt": "2026-07-30T08:55:38.316Z",
  "total": 146,
  "pets": [
    {
      "slug": "kesha",
      "displayName": "Kesha",
      "petJsonUrl": "/api/assets/asset_c4f97b4b4981/pet.json",
      "spritesheetUrl": "/api/assets/asset_c4f97b4b4981/spritesheet.webp",
      "zipUrl": "/api/assets/asset_c4f97b4b4981/pet.zip",
      …
    },
    … 145 more approved pets …
  ]
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "install",
    title: "Get install instructions for a slug",
    command: `curl -s ${toPublicUrl("/api/pets/anime-girl-3/install")}`,
    resultSummary: `Returned install commands for Codex, Cursor, Claude Code, and a manual pet.json plus spritesheet flow.`,
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
    "cursor": { "command": "npx @astandrik/codex-pets install anime-girl-3", … },
    "claudeCode": { … },
    "manual": { "steps": [ … ] }
  }
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "search",
    title: "Search the registry by keyword",
    command: `curl -s "${toPublicUrl("/api/pets")}?q=cat&pageSize=3"`,
    resultSummary: `Top matches on ${METHODOLOGY_RUN_DATE_LABEL}: Pink Catgirl, Neko Samurai, and Carmine. The MCP search_pets tool returns the same approved registry data.`,
    responseExcerpt: `{
  "total": 3,
  "pets": [
    {
      "slug": "pink-catgirl",
      "displayName": "Pink Catgirl",
      "tags": ["anime", "catgirl", "pink", "chibi"],
      "downloadCount": 47,
      …
    },
    { "slug": "neko-samurai-5", "displayName": "Neko Samurai", … },
    { "slug": "carmine-2", "displayName": "Carmine", … }
  ]
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "share",
    title: "Get share snippets for a pet page",
    command: `curl -s ${toPublicUrl("/api/pets/kesha/share")}`,
    resultSummary: `Returned ready-to-paste markdown badge, animated markdown card, iframe embed, and an install prompt for agent chats.`,
    responseExcerpt: `{
  "markdownBadge": "[![Codex pet: Kesha](${toPublicUrl("/badge/kesha.svg")})](…)",
  "markdownCard": "[![Kesha Codex pet](${toPublicUrl("/card/kesha.gif?mode=sprite&scale=2&state=idle")})](…)",
  "iframe": "<iframe title=\\"Codex pet: Kesha\\" src=\\"${toPublicUrl("/embed/kesha")}?…\\">…",
  "installPrompt": "Install the Kesha Codex pet from ${toPublicUrl("/pets/kesha")}",
  …
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
];

export const VS_VSCODE_PETS_DECISION_ROWS: GuideDecisionRow[] = [
  {
    surface: "Codex Pets pet packs",
    useWhen:
      "Your AI coding agent runs on your machine (Codex, Claude Code, Cursor) and can load a local pet.json plus spritesheet pack.",
    example: "npx @astandrik/codex-pets install kesha",
  },
  {
    surface: "Codex Pets registry (MCP/HTTP)",
    useWhen:
      "The agent should search or browse the approved catalog itself through tools or plain HTTP.",
    example: "search_pets, GET /api/pets?q=cat",
  },
  {
    surface: "Codex Pets share snippets",
    useWhen:
      "You want a badge, animated card, or iframe of a pet inside a README, doc, or chat.",
    example: "GET /api/pets/kesha/share",
  },
  {
    surface: "VS Code Pets extension",
    useWhen:
      "You want a pixel pet panel inside VS Code only, with no machine-level agent access and no pack installs.",
    example: "ext install tonybaloney.vscode-pets",
  },
];

export const VS_VSCODE_PETS_SOURCES: { label: string; url: string }[] = [
  {
    label: "VS Code Pets on the Visual Studio Marketplace",
    url: "https://marketplace.visualstudio.com/items?itemName=tonybaloney.vscode-pets",
  },
  {
    label: "tonybaloney/vscode-pets on GitHub",
    url: "https://github.com/tonybaloney/vscode-pets",
  },
  {
    label: "VS Code Pets documentation",
    url: "https://tonybaloney.github.io/vscode-pets/",
  },
];

export function getVsVsCodePetsGuideJsonLd(): Record<string, unknown> {
  return buildGuideArticleJsonLd({
    path: VS_VSCODE_PETS_GUIDE_PATH,
    title: VS_VSCODE_PETS_GUIDE_TITLE,
    description: VS_VSCODE_PETS_GUIDE_DESCRIPTION,
    datePublished: VS_VSCODE_PETS_DATE_PUBLISHED,
    dateModified: VS_VSCODE_PETS_DATE_MODIFIED,
    type: "Article",
  });
}

export function buildVsVsCodePetsGuideMarkdown(pets: PublicPet[]): string {
  const examplePets = selectGuideExamplePets(pets, 5);
  const exampleBlocks = VS_VSCODE_PETS_QUERY_EXAMPLES.map((example) =>
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
    `# ${VS_VSCODE_PETS_GUIDE_TITLE}`,
    "",
    `> ${VS_VSCODE_PETS_GUIDE_DESCRIPTION}`,
    "",
    formatGuideByline({
      datePublished: VS_VSCODE_PETS_DATE_PUBLISHED,
      dateModified: VS_VSCODE_PETS_DATE_MODIFIED,
    }),
    "",
    "## How we tested",
    "",
    `We ran these reproducible checks against the production Codex Pets deployment on ${METHODOLOGY_RUN_DATE_LABEL}. Each one uses only public read-only routes, so you can repeat them verbatim.`,
    "",
    "What we did not test: we did not run the VS Code Pets extension again for this update. Every competitor claim below comes from its official marketplace page, README, or docs, each linked in Sources.",
    "",
    ...exampleBlocks,
    "",
    "## What VS Code Pets actually is",
    "",
    "VS Code Pets is a VS Code extension by Anthony Shaw. Per its marketplace page and README, it adds a panel with \u201ca bored cat, enthusiastic dog, feisty snake, rubber duck, or Clippy in your code editor\u201d.",
    "",
    "- Pets live inside a VS Code panel and are started with the \u201cVS Code Pets: Start pet coding session\u201d command.",
    "- The extension supports multiple pets at once, color themes, and throwing a ball to play with them.",
    "- It does not read your filesystem, install packs, or expose a registry API to coding agents.",
    "",
    "Codex Pets is the opposite shape: a public registry of pet packs (pet.json plus a spritesheet atlas) that AI coding agents discover, install, and animate on the machine they already run on.",
    "",
    "## Which one fits?",
    "",
    formatMarkdownDecisionTable(VS_VSCODE_PETS_DECISION_ROWS),
    "",
    "## Example pets from this guide",
    "",
    ...(petLines.length > 0
      ? petLines
      : ["- No approved pets are listed yet."]),
    "",
    "## Sources",
    "",
    ...VS_VSCODE_PETS_SOURCES.map(
      (source) => `- [${source.label}](${source.url})`,
    ),
    "",
    "## Links",
    "",
    `- Gallery: ${toPublicUrl("/")}`,
    `- Agent access: ${toPublicUrl("/agents")}`,
    `- OpenAPI: ${toPublicUrl("/openapi.json")}`,
    `- API llms.txt: ${toPublicUrl("/docs/llms.txt")}`,
    `- Codex Pets MCP integration guide: ${toPublicUrl("/guides/codex-pets-mcp-integration-guide")}`,
  ].join("\n");
}
