import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Plus, TerminalLine } from "@gravity-ui/icons";
import { Button, Container, Flex, Label, Text } from "@/components/GravityUI/GravityUI";

import { toPublicUrl, withBasePath } from "@/lib/base-path";
import {
  getOpenGraphImages,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";
import "./about.scss";

const ABOUT_DESCRIPTION =
  "Learn how Codex Pets works: a moderated community gallery, npm CLI installer, and Codex-compatible pet pack format.";
const INSTALL_COMMAND = "npx @astandrik/codex-pets install zero-two-2";

const packFacts = [
  "pet.json metadata",
  "spritesheet.webp or spritesheet.png",
  "8x9 atlas at 1536x1872",
  "reviewed before public listing",
];

const faqs = [
  {
    question: "What is a Codex pet?",
    answer:
      "A Codex pet is a small animated companion that Codex can display while you work. Each public listing in this gallery is a downloadable pet pack with metadata and pixel art.",
  },
  {
    question: "How do I install one?",
    answer:
      "Use the npm CLI command from the gallery or a pet detail page. The CLI reads the public manifest, downloads the pet files, and writes them into your Codex pets directory.",
  },
  {
    question: "Can I submit my own pet?",
    answer:
      "Yes. Upload a ZIP, or upload pet.json plus spritesheet.webp or spritesheet.png from the submit page. New submissions stay pending until an admin reviews them.",
  },
  {
    question: "What files does a pack need?",
    answer:
      "A pack needs pet.json and one spritesheet file at the root. The current validator expects an 8x9 atlas at 1536x1872, with each cell sized for Codex pet animation states.",
  },
];

export const metadata: Metadata = {
  title: "About Codex Pets",
  description: ABOUT_DESCRIPTION,
  alternates: {
    canonical: withBasePath("/about"),
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "About Codex Pets",
    description: ABOUT_DESCRIPTION,
    url: withBasePath("/about"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "About Codex Pets",
    description: ABOUT_DESCRIPTION,
    images: getTwitterImages(),
  },
};

export default function AboutPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    name: "About Codex Pets",
    url: toPublicUrl("/about"),
    description: ABOUT_DESCRIPTION,
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: toPublicUrl("/"),
    },
  };

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell about-page">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <section className="about-hero">
        <Flex
          alignItems="center"
          justifyContent="space-between"
          gap={8}
          wrap
          className="about-hero__inner"
        >
          <Flex direction="column" gap={3} className="about-hero__copy">
            <Label theme="info">About</Label>
            <Text variant="display-2" as="h1">
              Codex Pets is the gallery for Codex companions
            </Text>
            <Text variant="body-2" color="secondary" className="about-hero__lead">
              Browse community-made animated pet packs, install one with the
              npm CLI, or submit your own two-file pack for moderation.
            </Text>
            <div className="about-command" aria-label="Example install command">
              <TerminalLine width={18} height={18} className="about-command__icon" />
              <code className="about-command__code">{INSTALL_COMMAND}</code>
            </div>
            <Flex gap={2} wrap className="about-hero__actions">
              <Button view="action" size="l" href={withBasePath("/")}>
                Browse gallery
                <ArrowRight />
              </Button>
              <Button view="outlined" size="l" href={withBasePath("/submit")}>
                <Plus />
                Submit a pet
              </Button>
            </Flex>
          </Flex>

          <div className="about-pack" aria-label="Pet pack contents">
            <Text variant="subheader-2" as="h2" className="about-pack__title">
              Pack format
            </Text>
            <ul className="about-pack__list">
              {packFacts.map((fact) => (
                <li key={fact} className="about-pack__item">
                  <span className="about-pack__icon" aria-hidden="true">
                    <Check width={16} height={16} />
                  </span>
                  <span>{fact}</span>
                </li>
              ))}
            </ul>
          </div>
        </Flex>
      </section>

      <section className="page-section about-sections" aria-label="How Codex Pets works">
        <article className="about-section">
          <Text variant="display-1" as="h2">
            What Codex Pets is
          </Text>
          <Text variant="body-2" color="secondary">
            Codex Pets is a public gallery for Codex-compatible animated pets.
            Each approved entry has a detail page, previewable animation states,
            a downloadable ZIP, and links to its source <code>pet.json</code>{" "}
            and spritesheet assets.
          </Text>
        </article>

        <article className="about-section">
          <Text variant="display-1" as="h2">
            How a pet pack works
          </Text>
          <Text variant="body-2" color="secondary">
            A pack is intentionally small: <code>pet.json</code> describes the
            pet metadata and animation settings, while{" "}
            <code>spritesheet.webp</code> or <code>spritesheet.png</code>{" "}
            contains the visual atlas. The current atlas is 8 columns by 9 rows
            at <code>1536x1872</code>.
          </Text>
        </article>

        <article className="about-section">
          <Text variant="display-1" as="h2">
            Install or submit
          </Text>
          <Text variant="body-2" color="secondary">
            Approved pets can be installed from npm with the Codex Pets CLI.
            Creators can submit packs from the <Link href="/submit">submit page</Link>;
            admins review every submission before it appears in the gallery,
            sitemap, and public manifest.
          </Text>
        </article>
      </section>

      <section className="page-section about-faq" aria-labelledby="about-faq-title">
        <Text variant="display-1" as="h2" id="about-faq-title">
          FAQ
        </Text>
        <div className="about-faq__list">
          {faqs.map((item) => (
            <article key={item.question} className="about-faq__item">
              <Text variant="subheader-2" as="h3">
                {item.question}
              </Text>
              <Text variant="body-2" color="secondary">
                {item.answer}
              </Text>
            </article>
          ))}
        </div>
      </section>
    </Container>
  );
}
