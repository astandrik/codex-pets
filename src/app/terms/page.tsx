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

const TERMS_DESCRIPTION =
  "Codex Pets terms for the free community registry, moderated submissions, public agent access, and best-effort APIs.";

export const metadata: Metadata = {
  title: "Codex Pets terms",
  description: TERMS_DESCRIPTION,
  other: getPageViewOtherMetadata("/terms", "Codex Pets terms"),
  alternates: {
    canonical: withBasePath("/terms"),
    types: getAgentResourceAlternateTypes(),
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Codex Pets terms",
    description: TERMS_DESCRIPTION,
    url: withBasePath("/terms"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Pets terms",
    description: TERMS_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function TermsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Codex Pets terms",
    url: toPublicUrl("/terms"),
    description: TERMS_DESCRIPTION,
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
          <Label theme="info">Terms</Label>
          <Text variant="display-2" as="h1">
            Codex Pets terms
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Codex Pets is a free community registry for approved public pet
            packs. Public agent access is read-only, unauthenticated, and
            best-effort.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/pricing")}>
              Pricing
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/developers")}>
              Developer portal
              <ArrowRight />
            </Button>
            <Button view="flat" size="l" href={withBasePath("/terms.md")}>
              Markdown
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Public use terms
        </Text>
        <ul>
          <li>Public registry data and MCP tools expose approved pet data only.</li>
          <li>Submissions can be rejected, edited, hidden, or deleted through moderation.</li>
          <li>
            Private contact fields are not public. A separately requested and
            moderator-verified author email becomes public registry data.
          </li>
          <li>Admin routes and owner-only routes are not public agent data.</li>
          <li>The service has no paid SLA and may change with published deprecation notice for breaking public-agent changes.</li>
        </ul>
      </section>
    </Container>
  );
}
