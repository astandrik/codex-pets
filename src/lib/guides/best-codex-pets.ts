import {
  escapeMarkdownInlineText,
  formatMarkdownInlineList,
} from "@/lib/agent-markdown";
import { toPublicUrl } from "@/lib/base-path";
import { buildPetInstallCommand } from "@/lib/pets/install-command";
import type { PublicPet } from "@/lib/pets/types";
import { SITE_NAME } from "@/lib/site-metadata";

export const BEST_CODEX_PETS_GUIDE_PATH =
  "/guides/best-codex-pets-for-ai-coding-agents";
export const BEST_CODEX_PETS_GUIDE_MARKDOWN_PATH =
  "/guides/best-codex-pets-for-ai-coding-agents.md";
export const BEST_CODEX_PETS_GUIDE_TITLE =
  "Best Codex pets for AI coding agents";

const SECTION_LIMIT = 5;

const SECTION_DEFINITIONS = [
  {
    id: "anime",
    title: "Best anime Codex pets",
    question: "What are the best anime Codex pets?",
    summaryLabel: "anime",
    tags: ["anime", "chibi", "jrpg", "catgirl", "elf", "idol"],
    reason: "Matches anime-style tags and works well as a character companion.",
  },
  {
    id: "cute",
    title: "Best cute and cozy Codex pets",
    question: "What are the best cute and cozy Codex pets?",
    summaryLabel: "cute and cozy",
    tags: ["cute", "cozy", "friendly", "round", "soft", "cartoon", "chibi"],
    reason: "Matches cute or cozy tags for a low-friction coding companion.",
  },
  {
    id: "pixel",
    title: "Best pixel and retro Codex pets",
    question: "What are the best pixel or retro Codex pets?",
    summaryLabel: "pixel and retro",
    tags: ["pixel", "pixel art", "retro", "8-bit", "sprite"],
    reason: "Matches pixel or retro tags for sprite-forward terminal workflows.",
  },
  {
    id: "minimal",
    title: "Best minimal and terminal Codex pets",
    question: "What are the best minimal or terminal-friendly Codex pets?",
    summaryLabel: "minimal and terminal",
    tags: ["minimal", "terminal", "low-noise", "simple"],
    reason: "Matches minimal or terminal tags for quieter coding sessions.",
  },
  {
    id: "fantasy",
    title: "Best fantasy and unusual Codex pets",
    question: "What are the best fantasy or unusual Codex pets?",
    summaryLabel: "fantasy and unusual",
    tags: ["fantasy", "unusual", "rogue", "gothic", "creature", "epic"],
    reason: "Matches fantasy or unusual tags for more expressive companions.",
  },
] as const;

export type BestCodexPetGuideSectionId =
  (typeof SECTION_DEFINITIONS)[number]["id"];

export type BestCodexPetGuideItem = {
  slug: string;
  displayName: string;
  description: string;
  kind: PublicPet["kind"];
  tags: string[];
  pageUrl: string;
  installCommand: string;
  reason: string;
};

export type BestCodexPetGuideSection = {
  id: BestCodexPetGuideSectionId;
  title: string;
  question: string;
  summaryLabel: string;
  tags: readonly string[];
  pets: BestCodexPetGuideItem[];
};

export function buildBestCodexPetGuideSections(
  pets: PublicPet[],
): BestCodexPetGuideSection[] {
  return SECTION_DEFINITIONS.map((definition) => ({
    ...definition,
    pets: pets
      .filter((pet) => matchesAnyTag(pet.tags, definition.tags))
      .toSorted(compareGuidePets)
      .slice(0, SECTION_LIMIT)
      .map((pet) => ({
        slug: pet.slug,
        displayName: pet.displayName,
        description: pet.description,
        kind: pet.kind,
        tags: pet.tags,
        pageUrl: toPublicUrl(`/pets/${encodeURIComponent(pet.slug)}`),
        installCommand: buildPetInstallCommand(pet.slug),
        reason: definition.reason,
      })),
  }));
}

export function buildBestCodexPetGuideSummary(
  sections: BestCodexPetGuideSection[],
): string {
  const seen = new Set<string>();
  const picks: string[] = [];

  for (const section of sections) {
    const pet = section.pets.find((item) => !seen.has(item.slug));
    if (!pet) continue;

    seen.add(pet.slug);
    picks.push(`${pet.displayName} for ${section.summaryLabel}`);
    if (picks.length >= 3) break;
  }

  if (picks.length === 0) {
    return "No approved Codex pets match the guide categories yet.";
  }

  return `Best Codex pets to try first: ${formatList(picks)}.`;
}

export function buildBestCodexPetsGuideMarkdown(
  sections: BestCodexPetGuideSection[],
): string {
  const summary = buildBestCodexPetGuideMarkdownSummary(sections);
  const sectionBlocks = sections.map((section) => {
    const pets =
      section.pets.length > 0
        ? section.pets.map(formatGuidePetMarkdown).join("\n")
        : "- No approved pets currently match this category.";

    return [
      `## ${section.question}`,
      "",
      section.pets.length > 0
        ? `${escapeMarkdownInlineText(section.pets[0].displayName)} is the first recommendation for ${section.summaryLabel} Codex pet requests.`
        : "There is no current approved recommendation for this category.",
      "",
      pets,
    ].join("\n");
  });

  return [
    `# ${BEST_CODEX_PETS_GUIDE_TITLE}`,
    "",
    `> A practical roundup of approved ${SITE_NAME} packs that agents can cite, inspect, and install.`,
    "",
    summary,
    "",
    `- Gallery: ${toPublicUrl("/")}`,
    `- Manifest: ${toPublicUrl("/api/manifest")}`,
    `- MCP endpoint: ${toPublicUrl("/mcp")}`,
    "",
    ...sectionBlocks,
  ].join("\n");
}

export function getBestCodexPetsGuideJsonLd(
  sections: BestCodexPetGuideSection[],
) {
  const pageUrl = toPublicUrl(BEST_CODEX_PETS_GUIDE_PATH);
  const items = uniqueGuideItems(sections);

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        headline: BEST_CODEX_PETS_GUIDE_TITLE,
        url: pageUrl,
        description:
          "A practical guide to choosing the best Codex pets for AI coding agents, including install, preview, and agent-readable discovery paths.",
        isPartOf: {
          "@type": "WebSite",
          name: SITE_NAME,
          url: toPublicUrl("/"),
        },
      },
      {
        "@type": "ItemList",
        "@id": `${pageUrl}#recommended-pets`,
        name: "Recommended Codex pet packs by workflow",
        numberOfItems: items.length,
        itemListElement: items.map((item, index) => ({
          "@type": "ListItem",
          position: index + 1,
          name: item.displayName,
          url: item.pageUrl,
        })),
      },
      {
        "@type": "FAQPage",
        "@id": `${pageUrl}#faq`,
        mainEntity: sections.map((section) => ({
          "@type": "Question",
          name: section.question,
          acceptedAnswer: {
            "@type": "Answer",
            text:
              section.pets.length > 0
                ? `${section.pets[0].displayName} is the first recommendation. Other matching Codex pets include ${formatList(
                    section.pets.map((pet) => pet.displayName),
                  )}.`
                : "No approved Codex pets currently match this category.",
          },
        })),
      },
    ],
  };
}

function buildBestCodexPetGuideMarkdownSummary(
  sections: BestCodexPetGuideSection[],
): string {
  const seen = new Set<string>();
  const picks: string[] = [];

  for (const section of sections) {
    const pet = section.pets.find((item) => !seen.has(item.slug));
    if (!pet) continue;

    seen.add(pet.slug);
    picks.push(
      `${escapeMarkdownInlineText(pet.displayName)} for ${section.summaryLabel}`,
    );
    if (picks.length >= 3) break;
  }

  if (picks.length === 0) {
    return "No approved Codex pets match the guide categories yet.";
  }

  return `Best Codex pets to try first: ${formatList(picks)}.`;
}

function formatGuidePetMarkdown(item: BestCodexPetGuideItem): string {
  const name = escapeMarkdownInlineText(item.displayName);
  const tags =
    item.tags.length > 0
      ? ` Tags: ${formatMarkdownInlineList(item.tags)}.`
      : "";

  return `- [${name}](${item.pageUrl}): ${item.reason}${tags} Install: \`${item.installCommand}\`.`;
}

function uniqueGuideItems(
  sections: BestCodexPetGuideSection[],
): BestCodexPetGuideItem[] {
  const seen = new Set<string>();
  const items: BestCodexPetGuideItem[] = [];

  for (const section of sections) {
    for (const pet of section.pets) {
      if (seen.has(pet.slug)) continue;
      seen.add(pet.slug);
      items.push(pet);
    }
  }

  return items;
}

function matchesAnyTag(petTags: string[], sectionTags: readonly string[]): boolean {
  const normalizedPetTags = petTags.map(normalizeTag);
  return sectionTags.some((sectionTag) => {
    const normalizedSectionTag = normalizeTag(sectionTag);
    return normalizedPetTags.some(
      (petTag) =>
        petTag === normalizedSectionTag ||
        petTag.includes(normalizedSectionTag),
    );
  });
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

function normalizeTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatList(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]}, ${values[1]}`;

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}
