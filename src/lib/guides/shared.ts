import { escapeMarkdownInlineText } from "@/lib/agent-markdown";
import { toPublicUrl } from "@/lib/base-path";
import { buildPetInstallCommand } from "@/lib/pets/install-command";
import type { PublicPet } from "@/lib/pets/types";
import { SITE_NAME } from "@/lib/site-metadata";

export const GUIDE_AUTHOR_NAME = "Codex Pets maintainers";

export type GuideDecisionRow = {
  surface: string;
  useWhen: string;
  example: string;
};

export type GuideQueryExample = {
  id: string;
  title: string;
  command: string;
  resultSummary: string;
  /**
   * Trimmed copy of the real production response captured on runDate.
   * Text is used instead of screenshots: it stays indexable, accessible,
   * and cheap to serve.
   */
  responseExcerpt: string;
  /** ISO date (YYYY-MM-DD) when the query was run against production. */
  runDate: string;
};

export function buildGuideArticleJsonLd(options: {
  path: string;
  title: string;
  description: string;
  /** ISO date of the guide's first publication. */
  datePublished: string;
  /** ISO date of the guide's last content update. */
  dateModified: string;
  type?: "Article" | "TechArticle";
}): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": options.type ?? "Article",
    headline: options.title,
    url: toPublicUrl(options.path),
    description: options.description,
    author: {
      "@type": "Organization",
      name: GUIDE_AUTHOR_NAME,
      url: toPublicUrl("/"),
    },
    datePublished: options.datePublished,
    dateModified: options.dateModified,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: toPublicUrl("/"),
    },
  };
}

const GUIDE_MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export function formatGuideDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const monthName = GUIDE_MONTHS[month - 1];
  if (!year || !monthName || !day) {
    return isoDate;
  }

  return `${monthName} ${day}, ${year}`;
}

export function formatGuideByline(options: {
  datePublished: string;
  dateModified: string;
}): string {
  return `By ${GUIDE_AUTHOR_NAME} · Published ${formatGuideDate(
    options.datePublished,
  )} · Updated ${formatGuideDate(options.dateModified)}`;
}

export function formatMarkdownDecisionTable(rows: GuideDecisionRow[]): string {
  const header = "| Surface | Use when | Example |";
  const divider = "| --- | --- | --- |";
  const body = rows.map(
    (row) =>
      `| ${escapeMarkdownInlineText(row.surface)} | ${escapeMarkdownInlineText(
        row.useWhen,
      )} | ${escapeMarkdownInlineText(row.example)} |`,
  );

  return [header, divider, ...body].join("\n");
}

export type GuideExamplePet = {
  slug: string;
  displayName: string;
  description: string;
  pageUrl: string;
  installCommand: string;
};

export function selectGuideExamplePets(
  pets: PublicPet[],
  limit = 3,
): GuideExamplePet[] {
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
