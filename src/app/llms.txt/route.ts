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
      `- [Submit a pet](${toPublicUrl("/submit")}): Upload a ZIP or pet.json plus spritesheet for moderation.`,
      "",
      "## Machine-readable resources",
      "",
      `- [Sitemap](${toPublicUrl("/sitemap.xml")}): Dynamic XML sitemap with public pages and approved pet pages.`,
      `- [Public manifest](${toPublicUrl("/api/manifest")}): JSON feed containing the current approved pet list and asset URLs.`,
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
