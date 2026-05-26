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
  "A practical guide to choosing the best Codex pets for AI coding agents, including install, preview, and agent-readable discovery paths.";

export const metadata: Metadata = {
  title: "Best Codex pets for AI coding agents",
  description: GUIDE_DESCRIPTION,
  alternates: {
    canonical: withBasePath("/guides/best-codex-pets-for-ai-coding-agents"),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: "Best Codex pets for AI coding agents",
    description: GUIDE_DESCRIPTION,
    url: withBasePath("/guides/best-codex-pets-for-ai-coding-agents"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Best Codex pets for AI coding agents",
    description: GUIDE_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function BestCodexPetsGuidePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Best Codex pets for AI coding agents",
    url: toPublicUrl("/guides/best-codex-pets-for-ai-coding-agents"),
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
          <Label theme="info">Guide</Label>
          <Text variant="display-2" as="h1">
            Best Codex pets for AI coding agents
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Choose Codex pet packs that are easy for agents to discover,
            install, cite, and hand back to a user.
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
          What to look for
        </Text>
        <ul>
          <li>Clear display name, description, kind, and tags.</li>
          <li>Approved package assets with pet.json and a valid spritesheet.</li>
          <li>Stable page URL, package URL, and install command.</li>
          <li>Share snippets for README badges, animated cards, and embeds.</li>
          <li>MCP and OpenAPI resources that agents can inspect directly.</li>
        </ul>
      </section>

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
    </Container>
  );
}
