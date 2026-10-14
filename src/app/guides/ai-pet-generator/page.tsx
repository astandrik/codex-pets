import type { Metadata } from "next";
import { ArrowRight } from "@gravity-ui/icons";
import { Button, Container, Flex, Label, Text } from "@/components/GravityUI/GravityUI";
import { withBasePath } from "@/lib/base-path";
import {
  AI_PET_GENERATOR_DATE,
  AI_PET_GENERATOR_DESCRIPTION,
  AI_PET_GENERATOR_PATH,
  AI_PET_GENERATOR_SECTIONS,
  AI_PET_GENERATOR_TITLE,
  AI_PET_GENERATOR_WARNING,
  getAiPetGeneratorJsonLd,
} from "@/lib/guides/ai-pet-generator";
import { formatGuideByline } from "@/lib/guides/shared";
import { serializeJsonLd } from "@/lib/json-ld";
import { getOpenGraphImages, getPageViewOtherMetadata, getTwitterImages, SITE_NAME } from "@/lib/site-metadata";
import "../guide.scss";

export const metadata: Metadata = {
  title: AI_PET_GENERATOR_TITLE,
  description: AI_PET_GENERATOR_DESCRIPTION,
  robots: { index: true, follow: true },
  alternates: { canonical: withBasePath(AI_PET_GENERATOR_PATH) },
  other: getPageViewOtherMetadata(AI_PET_GENERATOR_PATH, AI_PET_GENERATOR_TITLE),
  openGraph: {
    type: "article", siteName: SITE_NAME, title: AI_PET_GENERATOR_TITLE,
    description: AI_PET_GENERATOR_DESCRIPTION, url: withBasePath(AI_PET_GENERATOR_PATH), images: getOpenGraphImages(),
  },
  twitter: { card: "summary_large_image", title: AI_PET_GENERATOR_TITLE, description: AI_PET_GENERATOR_DESCRIPTION, images: getTwitterImages() },
};

export default function AiPetGeneratorGuidePage() {
  return <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(getAiPetGeneratorJsonLd()) }} />
    <section className="page-section-header">
      <Flex direction="column" gap={3}>
        <Label theme="warning">Experimental AI generation</Label>
        <Text variant="display-2" as="h1">{AI_PET_GENERATOR_TITLE}</Text>
        <Text variant="body-2" color="secondary" className="page-section-header__lead">{AI_PET_GENERATOR_DESCRIPTION}</Text>
        <Text className="guide-byline">{formatGuideByline({ datePublished: AI_PET_GENERATOR_DATE, dateModified: AI_PET_GENERATOR_DATE })}</Text>
        <Flex gap={2} wrap>
          <Button view="action" size="l" href={withBasePath("/generate")}>Generate a pet <ArrowRight /></Button>
          <Button view="outlined" size="l" href={withBasePath("/pets/trolleybus")}>See a generated pet</Button>
        </Flex>
        <Text variant="body-2">{AI_PET_GENERATOR_WARNING}</Text>
      </Flex>
    </section>
    {AI_PET_GENERATOR_SECTIONS.map(section => <section className="page-section" key={section.title}>
      <Text variant="display-1" as="h2">{section.title}</Text>
      {section.paragraphs.map(text => <p key={text}>{text}</p>)}
    </section>)}
    <section className="page-section">
      <Text variant="subheader-3" as="h2">More ways to get started</Text>
      <ul>
        <li><a href={withBasePath("/mcp.md")}>Read the remote MCP documentation</a>.</li>
        <li><a href={withBasePath("/request")}>Send a manual request to the admins</a> if you want help with a pet.</li>
        <li><a href={withBasePath(AI_PET_GENERATOR_PATH + ".md")}>Read this guide as Markdown</a>.</li>
      </ul>
    </section>
  </Container>;
}
