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
  getAgentResourceAlternateTypes,
  getOpenGraphImages,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

const DEVELOPERS_DESCRIPTION =
  "Codex Pets Developer Portal for API docs, OpenAPI, MCP, authentication notes, manifests, and webhooks status.";

const resources = [
  {
    label: "OpenAPI JSON",
    href: "/openapi.json",
    text: "Canonical OpenAPI 3.1 specification for public Codex Pets endpoints.",
  },
  {
    label: "API docs",
    href: "/docs/api",
    text: "Human-readable API docs for JSON, TOON, MCP, request, and submission routes.",
  },
  {
    label: "Full LLM context",
    href: "/llms-full.txt",
    text: "Expanded markdown context with API reference, auth notes, examples, and webhooks status.",
  },
  {
    label: "MCP metadata",
    href: "/server.json",
    text: "MCP Registry metadata for the public Streamable HTTP server.",
  },
  {
    label: "Developer llms.txt",
    href: "/developers/llms.txt",
    text: "Scoped developer-resource index for API, OpenAPI, MCP, auth, and agent guidance.",
  },
  {
    label: "MCP markdown",
    href: "/mcp.md",
    text: "Markdown MCP server guide with MCP App resource and CSP notes.",
  },
];

export const metadata: Metadata = {
  title: "Codex Pets Developer Portal",
  description: DEVELOPERS_DESCRIPTION,
  alternates: {
    canonical: withBasePath("/developers"),
    types: getAgentResourceAlternateTypes(),
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Codex Pets Developer Portal",
    description: DEVELOPERS_DESCRIPTION,
    url: withBasePath("/developers"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Pets Developer Portal",
    description: DEVELOPERS_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function DevelopersPage() {
  const mcpCommand = `codex mcp add codexPets --url ${toPublicUrl("/mcp")}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Codex Pets Developer Portal",
    name: "Codex Pets Developer Portal",
    url: toPublicUrl("/developers"),
    description: DEVELOPERS_DESCRIPTION,
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
          <Label theme="info">Developers</Label>
          <Text variant="display-2" as="h1">
            Codex Pets Developer Portal
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Build against the public Codex Pets registry with OpenAPI, MCP,
            JSON endpoints, TOON mirrors, and explicit authentication notes.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/openapi.json")}>
              OpenAPI JSON
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/docs/api")}>
              API docs
              <ArrowRight />
            </Button>
            <Button view="flat" size="l" href={withBasePath("/llms-full.txt")}>
              Full LLM context
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Start with MCP
        </Text>
        <pre>
          <code>{mcpCommand}</code>
        </pre>
        <Text variant="body-2" color="secondary">
          The MCP server is read-only and exposes approved public pet data plus
          request workflow discovery.
        </Text>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Developer resources
        </Text>
        <ul>
          {resources.map((resource) => (
            <li key={resource.href}>
              <a href={withBasePath(resource.href)}>{resource.label}</a>:{" "}
              {resource.text}
            </li>
          ))}
        </ul>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Auth and webhooks
        </Text>
        <ul>
          <li>Public read endpoints do not require authentication.</li>
          <li>
            AppSessionCookie is used by browser account flows and optional
            signed-in request attribution.
          </li>
          <li>
            ProxyBasic is supported when the deployment is protected by a
            trusted reverse proxy.
          </li>
          <li>OAuth 2.0 is not currently supported.</li>
          <li>Webhooks are not currently available.</li>
        </ul>
      </section>
    </Container>
  );
}
