import type { Metadata } from "next";
import { ArrowRight, TerminalLine } from "@gravity-ui/icons";
import {
  Button,
  Container,
  Flex,
  Label,
  Text,
} from "@/components/GravityUI/GravityUI";

import { toPublicUrl, withBasePath } from "@/lib/base-path";
import {
  getOpenGraphImages,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

const AGENTS_DESCRIPTION =
  "Connect coding agents to Codex Pets through the public read-only MCP endpoint and HTTP registry routes.";

export const metadata: Metadata = {
  title: "Agent Access",
  description: AGENTS_DESCRIPTION,
  alternates: {
    canonical: withBasePath("/agents"),
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Agent Access",
    description: AGENTS_DESCRIPTION,
    url: withBasePath("/agents"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Agent Access",
    description: AGENTS_DESCRIPTION,
    images: getTwitterImages(),
  },
};

const mcpUrl = toPublicUrl("/mcp");
const mcpCommand = `codex mcp add codexPets --url ${mcpUrl}`;
const configToml = [
  "[mcp_servers.codexPets]",
  `url = "${mcpUrl}"`,
].join("\n");

export default function AgentsPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: "Codex Pets Agent Access",
    url: toPublicUrl("/agents"),
    description: AGENTS_DESCRIPTION,
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
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="page-section">
        <Flex direction="column" gap={4}>
          <Label theme="info">Agents</Label>
          <Text variant="display-2" as="h1">
            Agent-readable Codex pet registry
          </Text>
          <Text variant="body-2" color="secondary" style={{ maxWidth: 760 }}>
            Find, install, and share approved Codex pets from your browser or
            directly from your AI coding agent. The MCP server and HTTP routes
            are read-only and return only approved public registry data.
          </Text>
          <Flex gap={2} wrap>
            <Button view="action" size="l" href={withBasePath("/mcp")}>
              <TerminalLine />
              MCP endpoint
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/api/manifest")}>
              Public manifest
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          Connect Codex
        </Text>
        <pre>
          <code>{mcpCommand}</code>
        </pre>
        <Text variant="body-2" color="secondary">
          Or add the Streamable HTTP server to <code>config.toml</code>:
        </Text>
        <pre>
          <code>{configToml}</code>
        </pre>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          MCP tools
        </Text>
        <ul>
          <li>
            <code>search_pets</code> searches approved pets by query, kind,
            tags, author, and compatibility.
          </li>
          <li>
            <code>get_pet</code> returns one sanitized public pet card.
          </li>
          <li>
            <code>get_install_instructions</code> returns CLI and manual install
            instructions without incrementing metrics.
          </li>
          <li>
            <code>get_badge_code</code> returns Markdown and HTML README badge
            snippets.
          </li>
          <li>
            <code>get_embed_code</code> returns iframe embed code.
          </li>
        </ul>
      </section>

      <section className="page-section">
        <Text variant="display-1" as="h2">
          HTTP contract
        </Text>
        <ul>
          <li>
            <code>/api/manifest</code> lists approved pets with install commands
            and asset URLs.
          </li>
          <li>
            <code>/api/pets</code> searches approved pets with <code>q</code>{" "}
            and <code>kind</code> query parameters.
          </li>
          <li>
            <code>/api/pets/&lt;slug&gt;/share</code> returns install, badge,
            and embed snippets.
          </li>
          <li>
            <code>/badge/&lt;slug&gt;.svg</code> and{" "}
            <code>/embed/&lt;slug&gt;</code> are public share surfaces.
          </li>
        </ul>
      </section>
    </Container>
  );
}
