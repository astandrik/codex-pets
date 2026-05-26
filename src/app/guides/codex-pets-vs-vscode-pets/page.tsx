import type { Metadata } from "next";
import { ArrowRight } from "@gravity-ui/icons";
import {
  Button,
  Container,
  Flex,
  Label,
  Text,
} from "@/components/GravityUI/GravityUI";

import { toPublicUrl, withBasePath } from "@/lib/base-path";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  getOpenGraphImages,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

const GUIDE_DESCRIPTION =
  "Compare Codex Pets and VS Code Pets for animated coding companions, with a focus on Codex installation, agent-readable discovery, MCP, and package portability.";

export const metadata: Metadata = {
  title: "Codex Pets vs VS Code Pets",
  description: GUIDE_DESCRIPTION,
  alternates: {
    canonical: withBasePath("/guides/codex-pets-vs-vscode-pets"),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: "Codex Pets vs VS Code Pets",
    description: GUIDE_DESCRIPTION,
    url: withBasePath("/guides/codex-pets-vs-vscode-pets"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Pets vs VS Code Pets",
    description: GUIDE_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function CodexPetsVsVsCodePetsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Codex Pets vs VS Code Pets",
    url: toPublicUrl("/guides/codex-pets-vs-vscode-pets"),
    description: GUIDE_DESCRIPTION,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: toPublicUrl("/"),
    },
  };

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <section className="page-section-header">
        <Flex direction="column" gap={3}>
          <Label theme="info">Comparison</Label>
          <Text variant="display-2" as="h1">
            Codex Pets vs VS Code Pets
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            VS Code Pets is a popular editor extension category leader. Codex
            Pets focuses on Codex-compatible downloadable pet packs and
            agent-readable registry access.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/")}>
              Browse Codex pets
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/developers")}>
              Developer resources
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          When to choose Codex Pets
        </Text>
        <ul>
          <li>You want pet packs designed for Codex rather than a VS Code extension.</li>
          <li>You need public manifest, OpenAPI, llms.txt, or MCP discovery.</li>
          <li>You want downloadable ZIP packages with pet.json and spritesheet assets.</li>
          <li>You want README badge, card, or iframe share snippets for approved pets.</li>
        </ul>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Agent-readiness difference
        </Text>
        <Text variant="body-2" color="secondary">
          Codex Pets exposes its registry through MCP, JSON, TOON, OpenAPI,
          sitemap, llms.txt, and llms-full.txt. That lets coding agents inspect
          the available pets and produce install instructions without scraping a
          visual gallery.
        </Text>
      </section>
    </Container>
  );
}
