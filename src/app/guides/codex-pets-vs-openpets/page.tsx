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
  getPageViewOtherMetadata,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

const GUIDE_DESCRIPTION =
  "Compare Codex Pets and OpenPets for AI coding agent companions, focusing on registry discovery, downloadable Codex pet packs, MCP access, and desktop status workflows.";

export const metadata: Metadata = {
  title: "Codex Pets vs OpenPets",
  description: GUIDE_DESCRIPTION,
  other: getPageViewOtherMetadata(
    "/guides/codex-pets-vs-openpets",
    "Codex Pets vs OpenPets",
  ),
  alternates: {
    canonical: withBasePath("/guides/codex-pets-vs-openpets"),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: "Codex Pets vs OpenPets",
    description: GUIDE_DESCRIPTION,
    url: withBasePath("/guides/codex-pets-vs-openpets"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Codex Pets vs OpenPets",
    description: GUIDE_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function CodexPetsVsOpenPetsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: "Codex Pets vs OpenPets",
    url: toPublicUrl("/guides/codex-pets-vs-openpets"),
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
            Codex Pets vs OpenPets
          </Text>
          <Text variant="body-2" color="secondary" className="page-section-header__lead">
            OpenPets is a desktop pet app for AI coding assistants. Codex Pets
            focuses on a moderated, agent-readable registry of downloadable
            Codex pet packs with stable package, API, and MCP discovery.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/")}>
              Browse Codex pets
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/agents")}>
              Agent access
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Primary difference
        </Text>
        <Text variant="body-2" color="secondary">
          OpenPets documents a local-first desktop app, MCP server, CLI, and
          assistant integrations for showing agent status on the user&apos;s
          desktop. Codex Pets is not a desktop status app; it is a public
          registry and package surface for Codex-compatible pet packs that
          agents can search, cite, install, and share.
        </Text>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          When to choose Codex Pets
        </Text>
        <ul>
          <li>You need downloadable Codex pet pack assets and stable slugs.</li>
          <li>You want OpenAPI, llms.txt, markdown, JSON, TOON, and MCP discovery.</li>
          <li>You need README badge, animated card, iframe, or install snippets.</li>
          <li>You want a moderated public gallery that agents can cite directly.</li>
        </ul>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          When OpenPets may fit better
        </Text>
        <ul>
          <li>You want a local desktop companion app reacting to agent status.</li>
          <li>You need local IPC, desktop windows, and assistant lifecycle hooks.</li>
          <li>You are choosing an app runtime rather than a public Codex pack registry.</li>
        </ul>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Source notes
        </Text>
        <Text variant="body-2" color="secondary">
          OpenPets positioning here is based on its public documentation at{" "}
          <a href="https://openpets.dev/docs">openpets.dev/docs</a>, which
          describes a desktop pet app, local socket architecture, MCP, CLI, and
          assistant integrations. Codex Pets positioning is based on this
          site&apos;s public registry, MCP, OpenAPI, and package routes.
        </Text>
      </section>
    </Container>
  );
}
