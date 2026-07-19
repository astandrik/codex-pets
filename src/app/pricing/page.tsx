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

const PRICING_DESCRIPTION =
  "Codex Pets is a free community registry for public Codex pet discovery, MCP access, and moderated pet submissions.";

export const metadata: Metadata = {
  title: "Codex Pets pricing",
  description: PRICING_DESCRIPTION,
  other: getPageViewOtherMetadata("/pricing", "Codex Pets pricing"),
  alternates: {
    canonical: withBasePath("/pricing"),
    types: getAgentResourceAlternateTypes(),
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Codex Pets pricing",
    description: PRICING_DESCRIPTION,
    url: withBasePath("/pricing"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Pets pricing",
    description: PRICING_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function PricingPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Codex Pets pricing",
    url: toPublicUrl("/pricing"),
    description: PRICING_DESCRIPTION,
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
          <Label theme="info">Pricing</Label>
          <Text variant="display-2" as="h1">
            Codex Pets pricing
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            Codex Pets is a free community registry. Public registry pages,
            JSON endpoints, TOON mirrors, markdown discovery resources, and the
            read-only MCP server are available without paid plans.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/api/manifest")}>
              Public manifest
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/terms")}>
              Terms
              <ArrowRight />
            </Button>
            <Button view="flat" size="l" href={withBasePath("/pricing.md")}>
              Markdown
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Free community registry
        </Text>
        <ul>
          <li>Public pet search, manifest, and MCP discovery are free to use.</li>
          <li>There are no paid plans, quotas, invoices, or commercial terms.</li>
          <li>Submissions and generation requests are moderated before listing.</li>
          <li>Public APIs are best-effort and do not include a paid SLA.</li>
        </ul>
      </section>
    </Container>
  );
}
