import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import Image from "next/image";
import { ArrowRight } from "@gravity-ui/icons";
import {
  Button,
  Container,
  Flex,
  Label,
  Text,
} from "@/components/GravityUI/GravityUI";

import { toPublicUrl, withBasePath } from "@/lib/base-path";
import {
  getMcpIntegrationGuideJsonLd,
  MCP_GUIDE_DECISION_ROWS,
  MCP_GUIDE_QUERY_EXAMPLES,
  MCP_INTEGRATION_GUIDE_DATE_MODIFIED,
  MCP_INTEGRATION_GUIDE_DATE_PUBLISHED,
  MCP_INTEGRATION_GUIDE_DESCRIPTION,
  MCP_INTEGRATION_GUIDE_PATH,
  MCP_INTEGRATION_GUIDE_TITLE,
  METHODOLOGY_RUN_DATE,
  selectMcpGuideExamplePets,
} from "@/lib/guides/codex-pets-mcp-integration";
import {
  formatGuideByline,
  formatGuideDate,
  GUIDE_AUTHOR_NAME,
} from "@/lib/guides/shared";
import { serializeJsonLd } from "@/lib/json-ld";
import { listApprovedPetsForSearch } from "@/lib/pets/repository";
import {
  getOpenGraphImages,
  getPageViewOtherMetadata,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

import "./guide.scss";

const MCP_GUIDE_PRIMARY_CTA_PATH = "/mcp.md";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: MCP_INTEGRATION_GUIDE_TITLE,
  description: MCP_INTEGRATION_GUIDE_DESCRIPTION,
  other: getPageViewOtherMetadata(
    MCP_INTEGRATION_GUIDE_PATH,
    MCP_INTEGRATION_GUIDE_TITLE,
  ),
  alternates: {
    canonical: withBasePath(MCP_INTEGRATION_GUIDE_PATH),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: MCP_INTEGRATION_GUIDE_TITLE,
    description: MCP_INTEGRATION_GUIDE_DESCRIPTION,
    url: withBasePath(MCP_INTEGRATION_GUIDE_PATH),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: MCP_INTEGRATION_GUIDE_TITLE,
    description: MCP_INTEGRATION_GUIDE_DESCRIPTION,
    images: getTwitterImages(),
  },
};

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPetsForSearch(),
  [
    "mcp-integration-guide",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

export default async function CodexPetsMcpIntegrationGuidePage() {
  const examplePets = selectMcpGuideExamplePets(await getApprovedPetsSnapshot());
  const jsonLd = getMcpIntegrationGuideJsonLd();
  const byline = formatGuideByline({
    datePublished: MCP_INTEGRATION_GUIDE_DATE_PUBLISHED,
    dateModified: MCP_INTEGRATION_GUIDE_DATE_MODIFIED,
  });

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <section className="page-section-header">
        <Flex direction="column" gap={3}>
          <Label theme="info">Integration guide</Label>
          <Text variant="display-2" as="h1">
            {MCP_INTEGRATION_GUIDE_TITLE}
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Use the public read-only MCP server when an agent should search
            approved Codex pet packs, fetch one pack, or generate install and
            share snippets without changing site data.
          </Text>
          <Text className="guide-byline">{byline}</Text>
          <Flex gap={2} wrap>
            <Button
              view="action"
              size="l"
              href={withBasePath(MCP_GUIDE_PRIMARY_CTA_PATH)}
            >
              MCP markdown
              <ArrowRight />
            </Button>
            <Button
              view="outlined"
              size="l"
              href={withBasePath("/.well-known/mcp/server-card.json")}
            >
              Server card
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
          The {GUIDE_AUTHOR_NAME} ran these reproducible checks against the
          production deployment on{" "}
          {formatGuideDate(METHODOLOGY_RUN_DATE)}. Each one uses
          only public read-only routes, so any agent or human can repeat them
          verbatim.
        </Text>
        {MCP_GUIDE_QUERY_EXAMPLES.map((example) => (
          <div className="guide-query-example" key={example.id}>
            <Text variant="subheader-2" as="h3">
              {example.title}
            </Text>
            <pre>
              <code>{example.command}</code>
            </pre>
            <Text variant="body-2" color="secondary">
              {example.resultSummary} (Run on {formatGuideDate(example.runDate)}
              .)
            </Text>
            {example.screenshot ? (
              <figure className="guide-screenshot">
                <Image
                  src={withBasePath(example.screenshot.path)}
                  alt={example.screenshot.alt}
                  width={example.screenshot.width}
                  height={example.screenshot.height}
                />
                <figcaption>
                  {example.screenshot.alt}. Captured{" "}
                  {formatGuideDate(example.runDate)}.
                </figcaption>
              </figure>
            ) : null}
          </div>
        ))}
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Which surface should your agent use?
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
              {MCP_GUIDE_DECISION_ROWS.map((row) => (
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
          Connect
        </Text>
        <pre>
          <code>
            {[
              `codex mcp add codexPets --url ${toPublicUrl("/mcp")}`,
              `curl -s ${toPublicUrl("/.well-known/mcp/server-card.json")}`,
              `curl -s ${toPublicUrl("/api/manifest")}`,
            ].join("\n")}
          </code>
        </pre>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Tool choices
        </Text>
        <ul>
          <li>Use <code>search_pets</code> for a vague style, tag, or category request.</li>
          <li>Use <code>get_pet</code> when the agent already has an approved slug.</li>
          <li>
            Use snippet tools for install instructions, README badges, animated
            cards, and iframe embeds.
          </li>
          <li>
            Use <code>get_pet_request_info</code> only to explain the public
            request form. It does not create private requests.
          </li>
        </ul>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Example pets from this guide
        </Text>
        <Text variant="body-2" color="secondary">
          Approved pets an agent can cite right now through any of the surfaces
          above.
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
          Fallbacks
        </Text>
        <ul>
          <li>
            Use <a href={withBasePath("/openapi.json")}>OpenAPI</a> for typed
            HTTP contracts.
          </li>
          <li>
            Use <a href={withBasePath("/developers/llms.txt")}>developer
            llms.txt</a> and <a href={withBasePath("/docs/llms.txt")}>API
            llms.txt</a> for scoped retrieval.
          </li>
          <li>
            Use <a href={withBasePath("/llms-full.txt")}>llms-full.txt</a> when
            the agent needs full product context in one request.
          </li>
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
            <a href={withBasePath("/guides/codex-pets-vs-vscode-pets")}>
              Codex Pets vs VS Code Pets
            </a>
          </li>
          <li>
            <a href={withBasePath("/guides/codex-pets-vs-openpets")}>
              Codex Pets vs OpenPets
            </a>
          </li>
        </ul>
      </section>
    </Container>
  );
}
