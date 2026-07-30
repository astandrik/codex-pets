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

import { toPublicUrl, withBasePath } from "@/lib/base-path";
import {
  BEST_CODEX_PETS_GUIDE_PATH,
  BEST_CODEX_PETS_GUIDE_TITLE,
  buildBestCodexPetGuideSections,
  buildBestCodexPetGuideSummary,
  getBestCodexPetsGuideJsonLd,
} from "@/lib/guides/best-codex-pets";
import { loadGuidePets } from "@/lib/guides/load-guide-pets";
import { serializeJsonLd } from "@/lib/json-ld";
import { listApprovedPets } from "@/lib/pets/repository";
import {
  getOpenGraphImages,
  getPageViewOtherMetadata,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

const GUIDE_DESCRIPTION =
  "A practical guide to choosing the best Codex pets for AI coding agents, including install, preview, and agent-readable discovery paths.";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: BEST_CODEX_PETS_GUIDE_TITLE,
  description: GUIDE_DESCRIPTION,
  other: getPageViewOtherMetadata(
    BEST_CODEX_PETS_GUIDE_PATH,
    BEST_CODEX_PETS_GUIDE_TITLE,
  ),
  alternates: {
    canonical: withBasePath(BEST_CODEX_PETS_GUIDE_PATH),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: BEST_CODEX_PETS_GUIDE_TITLE,
    description: GUIDE_DESCRIPTION,
    url: withBasePath(BEST_CODEX_PETS_GUIDE_PATH),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: BEST_CODEX_PETS_GUIDE_TITLE,
    description: GUIDE_DESCRIPTION,
    images: getTwitterImages(),
  },
};

const getApprovedPetsSnapshot = unstable_cache(
  async () => listApprovedPets(),
  [
    "best-codex-pets-guide",
    process.env.CODEX_PETS_DATA_SOURCE?.trim() || "ydb",
  ],
  { revalidate: 60 },
);

export default async function BestCodexPetsGuidePage() {
  const pets = await loadGuidePets(getApprovedPetsSnapshot);
  const sections = buildBestCodexPetGuideSections(pets);
  const summary = buildBestCodexPetGuideSummary(sections);
  const jsonLd = getBestCodexPetsGuideJsonLd(sections);

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <section className="page-section-header">
        <Flex direction="column" gap={3}>
          <Label theme="info">Guide</Label>
          <Text variant="display-2" as="h1">
            {BEST_CODEX_PETS_GUIDE_TITLE}
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            {summary} Choose Codex pet packs that are easy for agents to
            discover, install, cite, and hand back to a user.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/")}>
              Browse gallery
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/api/manifest")}>
              Manifest
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Which Codex pet should I try first?
        </Text>
        <Text variant="body-2" color="secondary">
          {summary} Each recommendation below is an approved public Codex pet
          pack with a stable page URL, package assets, and a ready install
          command.
        </Text>
      </section>

      {sections.map((section) => (
        <section className="page-section" key={section.id}>
          <Text variant="display-1" as="h2">
            {section.question}
          </Text>
          {section.pets.length > 0 ? (
            <div>
              {section.pets.map((pet) => (
                <article key={pet.slug}>
                  <Text variant="subheader-2" as="h3">
                    <a href={withBasePath(`/pets/${pet.slug}`)}>
                      {pet.displayName}
                    </a>
                  </Text>
                  <Text variant="body-2" color="secondary">
                    {pet.reason} {pet.description}
                  </Text>
                  <ul>
                    <li>
                      Page: <a href={pet.pageUrl}>{pet.pageUrl}</a>
                    </li>
                    <li>
                      Tags: {pet.tags.length > 0 ? pet.tags.join(", ") : "none"}
                    </li>
                    <li>
                      Install: <code>{pet.installCommand}</code>
                    </li>
                  </ul>
                </article>
              ))}
            </div>
          ) : (
            <Text variant="body-2" color="secondary">
              No approved pets currently match this category.
            </Text>
          )}
        </section>
      ))}

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Agent-friendly setup
        </Text>
        <pre>
          <code>
            {[
              `codex mcp add codexPets --url ${toPublicUrl("/mcp")}`,
              "npx @astandrik/codex-pets install <slug>",
            ].join("\n")}
          </code>
        </pre>
        <Text variant="body-2" color="secondary">
          Agents can use the manifest, OpenAPI spec, or MCP tools to find the
          right approved pet before presenting an install command.
        </Text>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Related guides
        </Text>
        <ul>
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
