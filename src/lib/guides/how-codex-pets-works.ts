import { toPublicUrl } from "@/lib/base-path";
import {
  buildGuideArticleJsonLd,
  formatGuideByline,
} from "@/lib/guides/shared";

export const HOW_CODEX_PETS_WORKS_PATH = "/guides/how-codex-pets-works";
export const HOW_CODEX_PETS_WORKS_MARKDOWN_PATH =
  "/guides/how-codex-pets-works.md";
export const HOW_CODEX_PETS_WORKS_TITLE = "How Codex Pets works";
export const HOW_CODEX_PETS_WORKS_DESCRIPTION =
  "An illustrated guide to how a two-file Codex pet pack moves through moderation, YDB, semantic search, and related-pet snapshots.";
export const HOW_CODEX_PETS_WORKS_DATE_PUBLISHED = "2026-08-06";
export const HOW_CODEX_PETS_WORKS_DATE_MODIFIED = "2026-08-06";

const ASSET_BASE_PATH = `${HOW_CODEX_PETS_WORKS_PATH}/assets`;

export const HOW_CODEX_PETS_WORKS_DIAGRAMS = [
  {
    id: "pet-pack-lifecycle",
    src: `${ASSET_BASE_PATH}/pet-pack-lifecycle.svg`,
    alt: "Flowchart showing pet.json and a spritesheet passing through validation, pending storage in YDB, moderation, public discovery, installation, and Codex",
    caption:
      "Only an approved two-file pack reaches the public gallery, APIs, MCP tools, and install paths.",
  },
  {
    id: "search-profile",
    src: `${ASSET_BASE_PATH}/search-profile.svg`,
    alt: "Flowchart showing metadata and four fixed spritesheet frames becoming versioned text and visual embeddings in YDB",
    caption:
      "Metadata produces the text profile; four reproducible atlas frames produce the visual profile.",
  },
  {
    id: "online-hybrid-search",
    src: `${ASSET_BASE_PATH}/online-hybrid-search.svg`,
    alt: "Flowchart showing hard filters, lexical ranking, text and visual similarity, weighted rank fusion, and lexical fallback",
    caption:
      "Three independent ranked lists are fused by position. If the semantic path fails, lexical results still return.",
  },
  {
    id: "related-pets-generation",
    src: `${ASSET_BASE_PATH}/related-pets-generation.svg`,
    alt: "Flowchart showing pairwise related-pet ranking, complete generation validation, atomic activation, heuristic fallback while building or failed, and retained previous snapshot data",
    caption:
      "A related-pet generation becomes visible only after every row is written and validated.",
  },
] as const;

export const HOW_CODEX_PETS_WORKS_SCREENSHOTS = [
  {
    id: "winnie-search",
    src: `${ASSET_BASE_PATH}/winnie-search.png`,
    alt: "Codex Pets search results showing Winnie first and Foggy Hedgehog second for a descriptive query",
    caption:
      "The query avoids Winnie’s name while mixing literal traits with mood and story cues; the final ranking can combine lexical, text, and visual signals.",
  },
  {
    id: "winnie-related",
    src: `${ASSET_BASE_PATH}/winnie-related.png`,
    alt: "Related Codex pets shown for Winnie, including Foggy Hedgehog, Ezhik, Krosh, and Cheburashka",
    caption:
      "The detail page reads one published snapshot instead of ranking the whole catalog on every request.",
  },
] as const;

export function getHowCodexPetsWorksJsonLd(): Record<string, unknown> {
  return buildGuideArticleJsonLd({
    path: HOW_CODEX_PETS_WORKS_PATH,
    title: HOW_CODEX_PETS_WORKS_TITLE,
    description: HOW_CODEX_PETS_WORKS_DESCRIPTION,
    datePublished: HOW_CODEX_PETS_WORKS_DATE_PUBLISHED,
    dateModified: HOW_CODEX_PETS_WORKS_DATE_MODIFIED,
    type: "TechArticle",
  });
}

export function buildHowCodexPetsWorksMarkdown(): string {
  const [lifecycle, searchProfile, onlineSearch, relatedGeneration] =
    HOW_CODEX_PETS_WORKS_DIAGRAMS;
  const [searchScreenshot, relatedScreenshot] =
    HOW_CODEX_PETS_WORKS_SCREENSHOTS;

  return [
    `# ${HOW_CODEX_PETS_WORKS_TITLE}`,
    "",
    `> ${HOW_CODEX_PETS_WORKS_DESCRIPTION}`,
    "",
    formatGuideByline({
      datePublished: HOW_CODEX_PETS_WORKS_DATE_PUBLISHED,
      dateModified: HOW_CODEX_PETS_WORKS_DATE_MODIFIED,
    }),
    "",
    `- [Browse gallery](${toPublicUrl("/")})`,
    `- [Submit a pet](${toPublicUrl("/submit")})`,
    `- [Developer docs](${toPublicUrl("/developers")})`,
    "",
    "## A pet pack's path",
    "",
    "A Codex pet pack has two source files. pet.json describes the pet and its animation settings. A spritesheet.webp or spritesheet.png contains the animation atlas. Validation checks both files, and moderation decides whether the pack can become public.",
    "",
    markdownFigure(lifecycle),
    "",
    "Submitted metadata and binary assets are stored in YDB while the card is pending. Moderation changes its status; only an approved pack reaches the gallery, public APIs, read-only MCP tools, and install paths.",
    "",
    "## How a pet becomes searchable",
    "",
    "Name, description, kind, and tags become a canonical text document. Four fixed frames from the spritesheet are described by a caption model. The text document and visual caption are embedded separately.",
    "",
    markdownFigure(searchProfile),
    "",
    "YDB stores these derived vectors with a model revision, dimension count, and source hash. A changed card or atlas cannot silently reuse a vector built from older content.",
    "",
    "## Online hybrid search",
    "",
    "> Example query: an anxious brown bear from an old cartoon",
    "",
    "Hard kind, tag, and author filters run first. The remaining candidates are ranked lexically and by text and visual similarity. Weighted reciprocal rank fusion combines positions instead of comparing incompatible raw scores.",
    "",
    markdownFigure(onlineSearch),
    "",
    markdownFigure(searchScreenshot),
    "",
    "If the embedding model or vector query times out, the request returns lexical results instead of failing the gallery.",
    "",
    "## Related pets without half-published results",
    "",
    "Related pets reuse current metadata, text vectors, and visual vectors, but ranking happens in the background. Every pet is compared with the catalog and written into a new snapshot generation.",
    "",
    markdownFigure(relatedGeneration),
    "",
    markdownFigure(relatedScreenshot),
    "",
    "A generation is activated in one transaction only after every expected row is current and valid. While the related-pets state is building or failed, the detail page uses the heuristic order. The previous snapshot remains stored and recoverable, but it is not served until the state becomes ready again.",
    "",
    "## The short version",
    "",
    "- YDB stores source cards, binary assets, versioned embeddings, and published related-pet snapshots.",
    "- Model revisions and source hashes keep derived data aligned with the current pet pack.",
    "- Online search ranks the current query; related pets publish a complete precomputed generation.",
  ].join("\n");
}

function markdownFigure(figure: {
  src: string;
  alt: string;
  caption: string;
}): string {
  return [
    `![${figure.alt}](${toPublicUrl(figure.src)})`,
    "",
    `_${figure.caption}_`,
  ].join("\n");
}
