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
  getVsVsCodePetsGuideJsonLd,
  METHODOLOGY_RUN_DATE,
  VS_VSCODE_PETS_DATE_MODIFIED,
  VS_VSCODE_PETS_DATE_PUBLISHED,
  VS_VSCODE_PETS_DECISION_ROWS,
  VS_VSCODE_PETS_GUIDE_DESCRIPTION,
  VS_VSCODE_PETS_GUIDE_PATH,
  VS_VSCODE_PETS_GUIDE_TITLE,
  VS_VSCODE_PETS_QUERY_EXAMPLES,
  VS_VSCODE_PETS_SOURCES,
} from "@/lib/guides/codex-pets-vs-vscode-pets";
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
  title: VS_VSCODE_PETS_GUIDE_TITLE,
  description: VS_VSCODE_PETS_GUIDE_DESCRIPTION,
  other: getPageViewOtherMetadata(
    VS_VSCODE_PETS_GUIDE_PATH,
    VS_VSCODE_PETS_GUIDE_TITLE,
  ),
  alternates: {
    canonical: withBasePath(VS_VSCODE_PETS_GUIDE_PATH),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: VS_VSCODE_PETS_GUIDE_TITLE,
    description: VS_VSCODE_PETS_GUIDE_DESCRIPTION,
    url: withBasePath(VS_VSCODE_PETS_GUIDE_PATH),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: VS_VSCODE_PETS_GUIDE_TITLE,
    description: VS_VSCODE_PETS_GUIDE_DESCRIPTION,
    images: getTwitterImages(),
  },
};

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPetsForSearch(),
  [
    "vs-vscode-pets-guide",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

export default async function CodexPetsVsVsCodePetsGuidePage() {
  const examplePets = selectGuideExamplePets(await getApprovedPetsSnapshot(), 5);
  const jsonLd = getVsVsCodePetsGuideJsonLd();
  const byline = formatGuideByline({
    datePublished: VS_VSCODE_PETS_DATE_PUBLISHED,
    dateModified: VS_VSCODE_PETS_DATE_MODIFIED,
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
            {VS_VSCODE_PETS_GUIDE_TITLE}
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Two projects share the word pets and a pixel heart, but they solve
            different problems. This guide compares them with reproducible
            registry queries and a decision table for agent hosts.
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
              href="https://marketplace.visualstudio.com/items?itemName=tonybaloney.vscode-pets"
              target="_blank"
              rel="noopener noreferrer"
            >
              VS Code Pets marketplace
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
          production Codex Pets deployment on{" "}
          {formatGuideDate(METHODOLOGY_RUN_DATE)}. Each one uses only public
          read-only routes, so any agent or human can repeat them verbatim.
        </Text>
        <Text variant="body-2" color="secondary">
          What we did not test: we did not run the VS Code Pets extension again
          for this update. Every competitor claim below comes from its official
          marketplace page, README, or docs, each linked in Sources.
        </Text>
        {VS_VSCODE_PETS_QUERY_EXAMPLES.map((example) => (
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
          What VS Code Pets actually is
        </Text>
        <Text variant="body-2" color="secondary">
          VS Code Pets is a VS Code extension by Anthony Shaw. Per its{" "}
          <a href="https://marketplace.visualstudio.com/items?itemName=tonybaloney.vscode-pets">
            marketplace page
          </a>{" "}
          and{" "}
          <a href="https://github.com/tonybaloney/vscode-pets">README</a>, it
          adds a panel with a bored cat, enthusiastic dog, feisty snake, rubber
          duck, or Clippy in your code editor.
        </Text>
        <ul>
          <li>
            Pets live inside a VS Code panel and are started with the VS Code
            Pets: Start pet coding session command.
          </li>
          <li>
            The extension supports multiple pets at once, color themes, and
            throwing a ball to play with them.
          </li>
          <li>
            It does not read your filesystem, install packs, or expose a
            registry API to coding agents.
          </li>
        </ul>
        <Text variant="body-2" color="secondary">
          Codex Pets is the opposite shape: a public registry of pet packs
          (pet.json plus a spritesheet atlas) that AI coding agents discover,
          install, and animate on the machine they already run on.
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
              {VS_VSCODE_PETS_DECISION_ROWS.map((row) => (
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
          {VS_VSCODE_PETS_SOURCES.map((source) => (
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
            <a href={withBasePath("/guides/codex-pets-vs-openpets")}>
              Codex Pets vs OpenPets
            </a>
          </li>
        </ul>
      </section>
    </Container>
  );
}
