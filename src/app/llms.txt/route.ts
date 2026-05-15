import { toPublicUrl } from "@/lib/base-path";
import { listApprovedPets } from "@/lib/pets/repository";
import { PET_SHEET } from "@/lib/pets/types";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LISTED_PETS = 60;

export async function GET(): Promise<Response> {
  const pets = await listApprovedPets();
  const listedPets = pets.slice(0, MAX_LISTED_PETS);
  const generatedAt = new Date().toISOString();
  const petLines = listedPets.map((pet) => {
    const tags =
      pet.tags.length > 0
        ? ` Tags: ${pet.tags.map(formatInlineText).join(", ")}.`
        : "";

    return `- [${formatLinkText(pet.displayName)}](${toPublicUrl(`/pets/${pet.slug}`)}): Approved ${pet.kind} Codex pet pack.${tags}`;
  });
  const omittedNote =
    pets.length > listedPets.length
      ? `\n\nThe approved pet list is truncated to ${MAX_LISTED_PETS} entries. Use the public manifest for the full current list.`
      : "";

  return new Response(
    [
      `# ${SITE_NAME}`,
      "",
      `> ${SITE_DESCRIPTION}`,
      "",
      "Codex Pets is a moderated community gallery for downloadable Codex pet packs. Each public pet page describes one approved animated companion and links to its ZIP package, pet.json metadata, and spritesheet.",
      "Codex Pets is also an agent-readable registry. The public MCP endpoint and share routes expose only approved read-only pet data.",
      "",
      "Important notes:",
      "",
      `- Pet spritesheets use an ${PET_SHEET.columns}x${PET_SHEET.rows} atlas at ${PET_SHEET.width}x${PET_SHEET.height}.`,
      "- Public gallery and approved pet pages are intended for search and AI retrieval.",
      "- Admin, account, and API mutation routes are not intended as retrieval sources.",
      "- User-submitted pet pages are moderated before they appear in the public gallery.",
      `- Generated at ${generatedAt}.`,
      "",
      "## Core pages",
      "",
      `- [Gallery](${toPublicUrl("/")}): Browse approved Codex pet packs and search by name, description, kind, or tag.`,
      `- [About](${toPublicUrl("/about")}): Learn how Codex Pets works, including the package format, npm CLI installer, and moderation flow.`,
      `- [Agents](${toPublicUrl("/agents")}): Connect coding agents through MCP or the HTTP contract.`,
      `- [Submit a pet](${toPublicUrl("/submit")}): Upload a ZIP or pet.json plus spritesheet for moderation.`,
      "",
      "## Machine-readable resources",
      "",
      `- [Sitemap](${toPublicUrl("/sitemap.xml")}): Dynamic XML sitemap with public pages and approved pet pages.`,
      `- [Public manifest](${toPublicUrl("/api/manifest")}): JSON feed containing the current approved pet list, page URLs, install commands, and asset URLs.`,
      `- [Public pet search](${toPublicUrl("/api/pets")}): JSON endpoint for approved pets. Optional query parameters: q and kind=all|creature|object|character.`,
      `- [MCP endpoint](${toPublicUrl("/mcp")}): Streamable HTTP MCP server exposing read-only tools for approved pets.`,
      `- [Public tags](${toPublicUrl("/api/tags")}): JSON endpoint with current tag counts for approved pets.`,
      `- Pet detail JSON: ${toPublicUrl("/api/pets/{slug}")}. Replace {slug} with an approved pet slug from the manifest.`,
      `- Pet share JSON: ${toPublicUrl("/api/pets/{slug}/share")}. Returns install, badge, and embed snippets without private contact fields or metrics.`,
      `- Pet install JSON: ${toPublicUrl("/api/pets/{slug}/install")}. GET is read-only and does not increment install counters.`,
      `- Badge SVG: ${toPublicUrl("/badge/{slug}.svg")}. README badge for an approved pet.`,
      `- Card GIF: ${toPublicUrl("/card/{slug}.gif")}. Animated GIF for an approved pet. Query params: mode=sprite|card, state, scale. Default sharable output is sprite-only.`,
      `- Embed page: ${toPublicUrl("/embed/{slug}")}. Iframe-friendly HTML for an approved pet. Query params: mode=sprite|card, state, scale, theme, compact, showInstall, showAuthor, showTags.`,
      "",
      "## Agent access",
      "",
      `- Manifest: ${toPublicUrl("/api/manifest")}`,
      `- MCP config: codex mcp add codexPets --url ${toPublicUrl("/mcp")}`,
      "- MCP tools: search_pets, get_pet, get_install_instructions, get_badge_code, get_embed_code, get_card_code.",
      `- List or search approved pets: ${toPublicUrl("/api/pets")}`,
      `- Fetch one approved pet: ${toPublicUrl("/api/pets/{slug}")}`,
      "- Install command format: npx @astandrik/codex-pets install <slug>",
      "- Browser WebMCP is optional and browser-only. It requires a runtime that exposes navigator.modelContext after the page loads.",
      "- Browser WebMCP tools: search_codex_pets, get_codex_pet, get_codex_pets_manifest, get_current_codex_pet.",
      "",
      "## Approved pet packs",
      "",
      petLines.length > 0
        ? petLines.join("\n")
        : "- No approved pet packs are currently listed.",
      omittedNote,
      "",
      "## Optional",
      "",
      `- [Robots policy](${toPublicUrl("/robots.txt")}): Crawl policy for search and AI crawlers.`,
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
