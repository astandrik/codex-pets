import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { ArrowRight } from "@gravity-ui/icons";
import {
  Button,
  Container,
  Flex,
  Label,
  Text,
} from "@/components/GravityUI/GravityUI";

import { withBasePath } from "@/lib/base-path";
import {
  getVsOpenPetsGuideJsonLd,
  METHODOLOGY_RUN_DATE,
  OPENPETS_DATE_MODIFIED,
  OPENPETS_DATE_PUBLISHED,
  OPENPETS_DECISION_ROWS,
  OPENPETS_GUIDE_DESCRIPTION,
  OPENPETS_GUIDE_PATH,
  OPENPETS_GUIDE_TITLE,
  OPENPETS_QUERY_EXAMPLES,
  OPENPETS_SOURCES,
} from "@/lib/guides/codex-pets-vs-openpets";
import { loadGuidePets } from "@/lib/guides/load-guide-pets";
import {
  formatGuideByline,
  formatGuideDate,
  GUIDE_AUTHOR_NAME,
  selectGuideExamplePets,
} from "@/lib/guides/shared";
import { serializeJsonLd } from "@/lib/json-ld";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import {
  getOpenGraphImages,
  getPageViewOtherMetadata,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

import "../guide.scss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: OPENPETS_GUIDE_TITLE,
  description: OPENPETS_GUIDE_DESCRIPTION,
  other: getPageViewOtherMetadata(OPENPETS_GUIDE_PATH, OPENPETS_GUIDE_TITLE),
  alternates: {
    canonical: withBasePath(OPENPETS_GUIDE_PATH),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: OPENPETS_GUIDE_TITLE,
    description: OPENPETS_GUIDE_DESCRIPTION,
    url: withBasePath(OPENPETS_GUIDE_PATH),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: OPENPETS_GUIDE_TITLE,
    description: OPENPETS_GUIDE_DESCRIPTION,
    images: getTwitterImages(),
  },
};

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPetsForSearch(),
  [
    "vs-openpets-guide",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

export default async function CodexPetsVsOpenPetsGuidePage() {
  const examplePets = selectGuideExamplePets(
    await loadGuidePets(getApprovedPetsSnapshot),
    5,
  );
  const jsonLd = getVsOpenPetsGuideJsonLd();
  const byline = formatGuideByline({
    datePublished: OPENPETS_DATE_PUBLISHED,
    dateModified: OPENPETS_DATE_MODIFIED,
  });

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <section className="page-section-header">
        <Flex direction="column" gap={3}>
          <Label theme="info">Comparison guide</Label>
          <Text variant="display-2" as="h1">
            {OPENPETS_GUIDE_TITLE}
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Both projects put animated pets next to your coding agent, but one
            is a moderated public registry and the other is a desktop
            companion app. This guide compares them with reproducible queries
            against both public surfaces.
          </Text>
          <Text className="guide-byline">{byline}</Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/")}>
              Browse Codex pets
              <ArrowRight />
            </Button>
            <Button
              view="outlined"
              size="l"
              href="https://openpets.dev/docs"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenPets docs
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          How we tested
        </Text>
        <Text variant="body-2" color="secondary">
          The {GUIDE_AUTHOR_NAME} ran these reproducible checks on{" "}
          {formatGuideDate(METHODOLOGY_RUN_DATE)} against the production Codex
          Pets deployment and the public OpenPets catalog. Each one uses only
          public read-only routes, so any agent or human can repeat them
          verbatim.
        </Text>
        <Text variant="body-2" color="secondary">
          What we did not test: we did not install or run the OpenPets desktop
          app for this update. Every claim about its desktop runtime, leases,
          hooks, and plugins comes from the official OpenPets documentation,
          linked in Sources. The catalog numbers are first-hand: we fetched
          the public catalog descriptor ourselves, shown below.
        </Text>
        {OPENPETS_QUERY_EXAMPLES.map((example) => (
          <div className="guide-query-example" key={example.id}>
            <Text variant="subheader-2" as="h3">
              {example.title}
            </Text>
            <pre>
              <code>{example.command}</code>
            </pre>
            <pre>
              <code>{example.responseExcerpt}</code>
            </pre>
            <Text variant="body-2" color="secondary">
              {example.resultSummary} (Run on {formatGuideDate(example.runDate)}
              .)
            </Text>
          </div>
        ))}
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          What OpenPets actually is
        </Text>
        <Text variant="body-2" color="secondary">
          OpenPets is a local-first desktop companion app. Per its{" "}
          <a href="https://openpets.dev/docs">documentation</a>, it is an
          Electron app that lives in the system tray and puts an animated pet
          window on your desktop. AI assistants drive it through a stdio MCP
          server (<code>@open-pets/mcp</code>) with three tools —{" "}
          <code>openpets_status</code>, <code>openpets_react</code>,{" "}
          <code>openpets_say</code> — routed over a local socket with
          short-lived leases.
        </Text>
        <ul>
          <li>
            Its pet catalog is published as static paginated JSON; our own
            fetch counted 1,273 pets across 13 static pages, with a
            client-side static search index.
          </li>
          <li>
            It reacts to assistant status: reactions like thinking, editing,
            testing, and waiting map to pet animations, driven deliberately
            through MCP tools or automatically through Claude Code hooks.
          </li>
          <li>
            Its docs describe importing local Codex-format pets from
            ~/.codex/pets/ for in-development testing.
          </li>
          <li>
            It is a desktop runtime, not a public registry: no moderation
            status, download counters, or per-pet query API.
          </li>
        </ul>
        <Text variant="body-2" color="secondary">
          Codex Pets is the opposite shape: a moderated public registry of pet
          packs (pet.json plus a spritesheet atlas) that agents search, cite,
          install, and share through MCP tools, HTTP routes, OpenAPI, and
          llms.txt.
        </Text>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Which one fits?
        </Text>
        <div className="guide-decision-table-wrapper">
          <table className="guide-decision-table">
            <thead>
              <tr>
                <th>Surface</th>
                <th>Use when</th>
                <th>Example</th>
              </tr>
            </thead>
            <tbody>
              {OPENPETS_DECISION_ROWS.map((row) => (
                <tr key={row.surface}>
                  <td>{row.surface}</td>
                  <td>{row.useWhen}</td>
                  <td>
                    <code>{row.example}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Example pets from this guide
        </Text>
        <Text variant="body-2" color="secondary">
          Approved Codex pets an agent can cite right now through the registry
          surfaces above.
        </Text>
        {examplePets.map((pet) => (
          <article key={pet.slug}>
            <Text variant="subheader-2" as="h3">
              <a href={withBasePath(`/pets/${pet.slug}`)}>{pet.displayName}</a>
            </Text>
            <Text variant="body-2" color="secondary">
              {pet.description}
            </Text>
            <ul>
              <li>
                Page: <a href={pet.pageUrl}>{pet.pageUrl}</a>
              </li>
              <li>
                Install: <code>{pet.installCommand}</code>
              </li>
            </ul>
          </article>
        ))}
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Sources
        </Text>
        <ul>
          {OPENPETS_SOURCES.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noopener noreferrer">
                {source.label}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Related guides
        </Text>
        <ul>
          <li>
            <a href={withBasePath("/guides/best-codex-pets-for-ai-coding-agents")}>
              Best Codex pets for AI coding agents
            </a>
          </li>
          <li>
            <a href={withBasePath("/guides/codex-pets-mcp-integration-guide")}>
              Codex Pets MCP integration guide
            </a>
          </li>
          <li>
            <a href={withBasePath("/guides/codex-pets-vs-vscode-pets")}>
              Codex Pets vs VS Code Pets
            </a>
          </li>
        </ul>
      </section>
    </Container>
  );
}
