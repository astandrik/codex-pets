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

export const OPENPETS_GUIDE_PATH = "/guides/codex-pets-vs-openpets";
export const OPENPETS_GUIDE_TITLE = "Codex Pets vs OpenPets";
export const OPENPETS_GUIDE_DESCRIPTION =
  "A maintainer-written comparison of Codex Pets and OpenPets: a moderated agent-readable registry vs a local desktop companion app, with reproducible queries against both public surfaces and a decision table for agent hosts.";
export const OPENPETS_DATE_PUBLISHED = "2026-05-27";
export const OPENPETS_DATE_MODIFIED = "2026-07-30";

export const METHODOLOGY_RUN_DATE = "2026-07-30";
const METHODOLOGY_RUN_DATE_LABEL = formatGuideDate(METHODOLOGY_RUN_DATE);

export const OPENPETS_QUERY_EXAMPLES: GuideQueryExample[] = [
  {
    id: "pet-detail",
    title: "Fetch one approved pet as JSON",
    command: `curl -s ${toPublicUrl("/api/pets/kesha")}`,
    resultSummary: `Returned the full public record for one approved pet: moderation status, kind, tags, and the petJsonUrl, spritesheetUrl, and zipUrl a pack install needs.`,
    responseExcerpt: `{
  "pet": {
    "slug": "kesha",
    "displayName": "Kesha",
    "kind": "creature",
    "tags": ["corgi", "dog", "cute", "animated"],
    "status": "approved",
    "petJsonUrl": "/api/assets/asset_c4f97b4b4981/pet.json",
    "spritesheetUrl": "/api/assets/asset_c4f97b4b4981/spritesheet.webp",
    "zipUrl": "/api/assets/asset_c4f97b4b4981/pet.zip",
    "approvedAt": "2026-07-26T20:16:52.124Z",
    "downloadCount": 1
  }
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "tags",
    title: "List the registry tag vocabulary",
    command: `curl -s ${toPublicUrl("/api/tags")}`,
    resultSummary: `Returned 236 distinct tags across approved pets on ${METHODOLOGY_RUN_DATE_LABEL}, each with a usage count. Agents can ground their searches in this vocabulary instead of guessing keywords.`,
    responseExcerpt: `{
  "generatedAt": "2026-07-30T11:12:08.317Z",
  "total": 236,
  "tags": [
    { "name": "anime", "count": 64 },
    { "name": "chibi", "count": 43 },
    { "name": "girl", "count": 40 },
    { "name": "cartoon", "count": 12 },
    { "name": "final fantasy", "count": 10 },
    "… 231 more tags …"
  ]
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "search-kind",
    title: "Filter the registry by kind",
    command: `curl -s "${toPublicUrl("/api/pets")}?kind=character&pageSize=3"`,
    resultSummary: `First page of a live kind=character filter: Iris, Minty, and Sakura. Registry list endpoints support typed filters and pagination, so an agent never has to mirror the whole catalog to answer a question.`,
    responseExcerpt: `{
  "total": 3,
  "pets": [
    {
      "slug": "iris",
      "displayName": "Iris",
      "kind": "character",
      "tags": ["anime", "manga", "humanoid", "developer", "original", "source-github", "license-mit", "v2"],
      "status": "approved"
    },
    { "slug": "minty-codex-pet", "displayName": "…" },
    { "slug": "sakura", "displayName": "…" }
  ]
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "toon",
    title: "Read the same registry as TOON",
    command: `curl -s "${toPublicUrl("/api/pets.toon")}?q=cat"`,
    resultSummary: `The q=cat query matched 55 approved pets on ${METHODOLOGY_RUN_DATE_LABEL}. TOON is a compact, token-efficient rendering of the same approved registry data, built for agents that pay per token.`,
    responseExcerpt: `total: 55
pets[55]:
  - id: pet_897896f5b42c4ccda4a3ca
    slug: pink-catgirl
    displayName: Pink Catgirl
    kind: creature
    tags[4]: anime,catgirl,pink,chibi
    status: approved
    downloadCount: 47
  - …`,
    language: "toon",
    runDate: METHODOLOGY_RUN_DATE,
  },
  {
    id: "openpets-catalog",
    title: "Fetch the OpenPets public catalog descriptor",
    command: "curl -s https://openpets.dev/pets/catalog.v3.json",
    resultSummary: `Our own fetch of the OpenPets catalog descriptor on ${METHODOLOGY_RUN_DATE_LABEL}: 1,273 pets spread over 13 static JSON pages, plus a separate static search index. The descriptor carries no moderation status, per-pet counters, or live query API.`,
    responseExcerpt: `{
  "version": 3,
  "generatedAt": "2026-07-11T13:10:59.974Z",
  "total": 1273,
  "pageSize": 100,
  "search": "https://openpets.dev/pets/catalog.v3/search.json",
  "filters": {
    "categories": [
      { "id": "western", "label": "Western", "count": 376 },
      { "id": "asian", "label": "Asian", "count": 634 }
    ],
    "originalsCount": 47,
    "featuredCount": 263
  },
  "pages": [
    "https://openpets.dev/pets/catalog.v3/page-000.json",
    "… 12 more static pages …"
  ]
}`,
    runDate: METHODOLOGY_RUN_DATE,
  },
];

export const OPENPETS_DECISION_ROWS: GuideDecisionRow[] = [
  {
    surface: "Codex Pets pet packs",
    useWhen:
      "Your agent is Codex. The CLI installs packs into the Codex home directory; other hosts need the manual pet.json plus spritesheet steps.",
    example: "npx @astandrik/codex-pets install kesha",
  },
  {
    surface: "Codex Pets registry (MCP/HTTP)",
    useWhen:
      "The agent should search, filter, and cite the approved catalog itself through tools or plain HTTP, in JSON or TOON.",
    example: "search_pets, GET /api/pets?kind=character",
  },
  {
    surface: "OpenPets desktop app",
    useWhen:
      "You want an animated pet window on your OS desktop that reacts to assistant status over a local socket, MCP tools, or lifecycle hooks.",
    example: "npx -y @open-pets/mcp@latest",
  },
  {
    surface: "OpenPets + Codex Pets together",
    useWhen:
      "You develop packs locally and want to preview them on the desktop; the OpenPets docs describe importing Codex-format pets from ~/.codex/pets/ for testing.",
    example: "~/.codex/pets/<pet-id>/pet.json",
  },
];

export const OPENPETS_SOURCES: { label: string; url: string }[] = [
  {
    label: "OpenPets documentation",
    url: "https://openpets.dev/docs",
  },
  {
    label: "OpenPets public catalog descriptor",
    url: "https://openpets.dev/pets/catalog.v3.json",
  },
  {
    label: "OpenPets static search index",
    url: "https://openpets.dev/pets/catalog.v3/search.json",
  },
];

export function getVsOpenPetsGuideJsonLd(): Record<string, unknown> {
  return buildGuideArticleJsonLd({
    path: OPENPETS_GUIDE_PATH,
    title: OPENPETS_GUIDE_TITLE,
    description: OPENPETS_GUIDE_DESCRIPTION,
    datePublished: OPENPETS_DATE_PUBLISHED,
    dateModified: OPENPETS_DATE_MODIFIED,
    type: "Article",
  });
}

export function buildVsOpenPetsGuideMarkdown(pets: PublicPet[]): string {
  const examplePets = selectGuideExamplePets(pets, 5);
  const exampleBlocks = OPENPETS_QUERY_EXAMPLES.map((example) =>
    [
      `### ${example.title}`,
      "",
      `\`${example.command}\``,
      "",
      `\`\`\`${example.language ?? "json"}`,
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
    `# ${OPENPETS_GUIDE_TITLE}`,
    "",
    `> ${OPENPETS_GUIDE_DESCRIPTION}`,
    "",
    formatGuideByline({
      datePublished: OPENPETS_DATE_PUBLISHED,
      dateModified: OPENPETS_DATE_MODIFIED,
    }),
    "",
    "## How we tested",
    "",
    `We ran these reproducible checks on ${METHODOLOGY_RUN_DATE_LABEL} against the production Codex Pets deployment and the public OpenPets catalog. Each one uses only public read-only routes, so you can repeat them verbatim.`,
    "",
    "What we did not test: we did not install or run the OpenPets desktop app for this update. Every claim about its desktop runtime, leases, hooks, and plugins comes from the official OpenPets documentation, linked in Sources. The catalog numbers are first-hand: we fetched the public catalog descriptor ourselves, shown below.",
    "",
    ...exampleBlocks,
    "",
    "## What OpenPets actually is",
    "",
    "OpenPets is a local-first desktop companion app. Per its documentation, it is an Electron app that lives in the system tray and puts an animated pet window on your desktop. AI assistants drive it through a stdio MCP server (`@open-pets/mcp`) with three tools — `openpets_status`, `openpets_react`, `openpets_say` — routed over a local socket with short-lived leases.",
    "",
    "- Its pet catalog is published as static paginated JSON; our own fetch counted 1,273 pets across 13 static pages, with a client-side static search index.",
    "- It reacts to assistant status: reactions like thinking, editing, testing, and waiting map to pet animations, driven deliberately through MCP tools or automatically through Claude Code hooks.",
    "- Its docs describe importing local Codex-format pets from `~/.codex/pets/` for in-development testing.",
    "- It is a desktop runtime, not a public registry: no moderation status, download counters, or per-pet query API.",
    "",
    "Codex Pets is the opposite shape: a moderated public registry of pet packs (pet.json plus a spritesheet atlas) that agents search, cite, install, and share through MCP tools, HTTP routes, OpenAPI, and llms.txt.",
    "",
    "## Which one fits?",
    "",
    formatMarkdownDecisionTable(OPENPETS_DECISION_ROWS),
    "",
    "## Example pets from this guide",
    "",
    ...(petLines.length > 0
      ? petLines
      : ["- No approved pets are listed yet."]),
    "",
    "## Sources",
    "",
    ...OPENPETS_SOURCES.map(
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
    `- Codex Pets vs VS Code Pets: ${toPublicUrl("/guides/codex-pets-vs-vscode-pets")}`,
  ].join("\n");
}
