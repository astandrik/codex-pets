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
  "Integrate AI coding agents with Codex Pets through the read-only MCP server, OpenAPI spec, public manifest, markdown docs, and package install commands.";

export const metadata: Metadata = {
  title: "Codex Pets MCP integration guide",
  description: GUIDE_DESCRIPTION,
  alternates: {
    canonical: withBasePath("/guides/codex-pets-mcp-integration-guide"),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: "Codex Pets MCP integration guide",
    description: GUIDE_DESCRIPTION,
    url: withBasePath("/guides/codex-pets-mcp-integration-guide"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Pets MCP integration guide",
    description: GUIDE_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function CodexPetsMcpIntegrationGuidePage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Codex Pets MCP integration guide",
    url: toPublicUrl("/guides/codex-pets-mcp-integration-guide"),
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
          <Label theme="info">Integration guide</Label>
          <Text variant="display-2" as="h1">
            Codex Pets MCP integration guide
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Use the public read-only MCP server when an agent should search
            approved Codex pet packs, fetch one pack, or generate install and
            share snippets without changing site data.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/mcp")}>
              MCP endpoint
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/mcp.md")}>
              MCP markdown
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
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
    </Container>
  );
}
