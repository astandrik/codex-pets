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
  getPageViewOtherMetadata,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

const API_DESCRIPTION =
  "Codex Pets API docs for the public manifest, pet search, TOON mirrors, MCP endpoint, request flow, submission flow, and OpenAPI spec.";

const endpoints = [
  "GET /api/manifest",
  "GET /api/manifest.toon",
  "GET /api/pets?q=<query>&kind=all|creature|object|character&tags=<tags>&page=<n>&pageSize=<1..200>",
  "GET /api/pets.toon",
  "GET /api/pets/<slug>",
  "GET /api/pets/<slug>.toon",
  "GET /api/tags",
  "GET /api/tags.toon",
  "GET /api/pets/<slug>/share",
  "GET /api/pets/<slug>/install",
  "POST /api/generation-requests",
  "POST /api/submissions/register",
  "POST /mcp",
  "GET /.well-known/oauth-protected-resource",
  "GET /.well-known/oauth-protected-resource/mcp",
];

export const metadata: Metadata = {
  title: "Codex Pets API docs",
  description: API_DESCRIPTION,
  other: getPageViewOtherMetadata("/docs/api", "Codex Pets API docs"),
  alternates: {
    canonical: withBasePath("/docs/api"),
    types: getAgentResourceAlternateTypes(),
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Codex Pets API docs",
    description: API_DESCRIPTION,
    url: withBasePath("/docs/api"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Pets API docs",
    description: API_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function ApiDocsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: "Codex Pets API docs",
    name: "Codex Pets API docs",
    url: toPublicUrl("/docs/api"),
    description: API_DESCRIPTION,
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
          <Label theme="info">API docs</Label>
          <Text variant="display-2" as="h1">
            Codex Pets API docs
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Public agent/developer contract endpoints for approved pet
            discovery, install instructions, share snippets, MCP tools, pet
            generation requests, and moderated pet submissions.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/openapi.json")}>
              OpenAPI spec
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/developers")}>
              Developer portal
              <ArrowRight />
            </Button>
            <Button view="flat" size="l" href={withBasePath("/docs/llms.txt")}>
              API llms.txt
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Public endpoints
        </Text>
        <ul>
          {endpoints.map((endpoint) => (
            <li key={endpoint}>
              <code>{endpoint}</code>
            </li>
          ))}
        </ul>
        <Text variant="body-2" color="secondary">
          Supplying page or pageSize adds pagination metadata. In that response,
          top-level total is the number of returned pets, while
          pagination.totalItems is the full filtered count.
        </Text>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Examples
        </Text>
        <pre>
          <code>
            {[
              `curl -s ${toPublicUrl("/api/manifest")}`,
              `curl -s "${toPublicUrl("/api/pets")}?q=space&kind=creature"`,
              `curl -s "${toPublicUrl("/api/pets")}?page=2&pageSize=24"`,
              `curl -s ${toPublicUrl("/api/pets/{slug}/install")}`,
              `codex mcp add codexPets --url ${toPublicUrl("/mcp")}`,
            ].join("\n")}
          </code>
        </pre>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Authentication
        </Text>
        <Text variant="body-2" color="secondary">
          Public read endpoints are unauthenticated. AppSessionCookie and
          ProxyBasic are documented in the OpenAPI security schemes for browser
          account flows and trusted proxy deployments. OAuth 2.0 and webhooks
          are not currently available. Public metric mutation and download
          redirect routes are outside this OpenAPI contract.
        </Text>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Idempotency
        </Text>
        <Text variant="body-2" color="secondary">
          POST /api/generation-requests and POST /api/submissions/register
          accept an optional Idempotency-Key header for safe retries. Reusing
          the same key with the same normalized request body returns the first
          successful 201 response. Reusing it with a different body returns
          409 idempotency_key_conflict. Completed idempotency records are kept
          for 24 hours; after that retention window a key can be processed as a
          new request.
        </Text>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Versioning and deprecation
        </Text>
        <Text variant="body-2" color="secondary">
          Current unversioned public endpoints are stable v1. Additive response
          fields and new routes may be added without notice. Breaking
          public-agent contract changes require a new path or a published
          deprecation notice.
        </Text>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Agent discovery
        </Text>
        <ul>
          <li>
            <a href={withBasePath("/docs/llms.txt")}>API llms.txt</a> gives
            agents a scoped route map for API and MCP calls.
          </li>
          <li>
            <a href={withBasePath("/developers/llms.txt")}>Developer llms.txt</a>{" "}
            lists OpenAPI, MCP, auth, and developer-resource entry points by
            product name.
          </li>
          <li>
            <a href={withBasePath("/mcp.md")}>MCP markdown</a> documents the
            Streamable HTTP endpoint, server card, MCP App view, and CSP notes.
          </li>
          <li>
            <a href={withBasePath("/.well-known/oauth-protected-resource")}>
              OAuth Protected Resource metadata
            </a>{" "}
            makes the unauthenticated public access model machine-readable.
          </li>
        </ul>
      </section>
    </Container>
  );
}
