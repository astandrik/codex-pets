import type { Metadata } from "next";
import Image from "next/image";
import { ArrowRight, Plus } from "@gravity-ui/icons";
import {
  Button,
  Container,
  Flex,
  Label,
  Text,
} from "@/components/GravityUI/GravityUI";

import { withBasePath } from "@/lib/base-path";
import {
  getHowCodexPetsWorksJsonLd,
  HOW_CODEX_PETS_WORKS_DATE_MODIFIED,
  HOW_CODEX_PETS_WORKS_DATE_PUBLISHED,
  HOW_CODEX_PETS_WORKS_DESCRIPTION,
  HOW_CODEX_PETS_WORKS_DIAGRAMS,
  HOW_CODEX_PETS_WORKS_PATH,
  HOW_CODEX_PETS_WORKS_SCREENSHOTS,
  HOW_CODEX_PETS_WORKS_TITLE,
} from "@/lib/guides/how-codex-pets-works";
import { formatGuideByline } from "@/lib/guides/shared";
import { serializeJsonLd } from "@/lib/json-ld";
import {
  getOpenGraphImages,
  getPageViewOtherMetadata,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

import "../guide.scss";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: HOW_CODEX_PETS_WORKS_TITLE,
  description: HOW_CODEX_PETS_WORKS_DESCRIPTION,
  other: getPageViewOtherMetadata(
    HOW_CODEX_PETS_WORKS_PATH,
    HOW_CODEX_PETS_WORKS_TITLE,
  ),
  alternates: {
    canonical: withBasePath(HOW_CODEX_PETS_WORKS_PATH),
  },
  openGraph: {
    type: "article",
    siteName: SITE_NAME,
    title: HOW_CODEX_PETS_WORKS_TITLE,
    description: HOW_CODEX_PETS_WORKS_DESCRIPTION,
    url: withBasePath(HOW_CODEX_PETS_WORKS_PATH),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: HOW_CODEX_PETS_WORKS_TITLE,
    description: HOW_CODEX_PETS_WORKS_DESCRIPTION,
    images: getTwitterImages(),
  },
};

const [petPackLifecycle, searchProfile, onlineSearch, relatedGeneration] =
  HOW_CODEX_PETS_WORKS_DIAGRAMS;
const [winnieSearch, winnieRelated] = HOW_CODEX_PETS_WORKS_SCREENSHOTS;

type GuideFigureProps = {
  figure: {
    src: string;
    alt: string;
    caption: string;
  };
  kind: "diagram" | "screenshot";
  width: number;
  height: number;
};

export default function HowCodexPetsWorksPage() {
  const jsonLd = getHowCodexPetsWorksJsonLd();
  const byline = formatGuideByline({
    datePublished: HOW_CODEX_PETS_WORKS_DATE_PUBLISHED,
    dateModified: HOW_CODEX_PETS_WORKS_DATE_MODIFIED,
  });

  return (
    <Container
      as="main"
      maxWidth="xl"
      gutters={5}
      className="page-shell guide-visual-page"
    >
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />

      <section className="page-section-header guide-visual-hero">
        <Flex direction="column" gap={3}>
          <Label theme="info">Illustrated guide</Label>
          <Text variant="display-2" as="h1">
            {HOW_CODEX_PETS_WORKS_TITLE}
          </Text>
          <Text
            variant="body-2"
            color="secondary"
            className="page-section-header__lead guide-visual-hero__lead"
          >
            Two files become an animated coding companion. The same pack also
            becomes searchable by words, meaning, and visual appearance without
            adding another public source of truth.
          </Text>
          <Text className="guide-byline">{byline}</Text>
          <Flex gap={2} wrap className="guide-visual-hero__actions">
            <Button view="action" size="l" href={withBasePath("/")}>
              Browse gallery
              <ArrowRight />
            </Button>
            <Button view="outlined" size="l" href={withBasePath("/submit")}>
              <Plus />
              Submit a pet
            </Button>
            <Button view="flat" size="l" href={withBasePath("/developers")}>
              Developer docs
              <ArrowRight />
            </Button>
          </Flex>
        </Flex>
      </section>

      <section className="page-section guide-visual-section">
        <Text variant="display-1" as="h2">
          A pet pack&apos;s path
        </Text>
        <Text variant="body-2" color="secondary" className="guide-section-copy">
          A pack starts with <code>pet.json</code>, which describes metadata and
          animation settings, plus a <code>spritesheet.webp</code> or{" "}
          <code>spritesheet.png</code> atlas. Validation checks the pair, and
          moderation decides whether the pack can become public.
        </Text>
        <GuideFigure
          figure={petPackLifecycle}
          kind="diagram"
          width={559}
          height={745}
        />
        <Text variant="body-2" color="secondary" className="guide-section-copy">
          YDB stores submitted metadata and binary assets while the card is
          pending. Moderation changes its status; only an approved pack reaches
          the gallery, public APIs, read-only MCP tools, and install paths.
        </Text>
      </section>

      <section className="page-section guide-visual-section">
        <Text variant="display-1" as="h2">
          How a pet becomes searchable
        </Text>
        <Text variant="body-2" color="secondary" className="guide-section-copy">
          Name, description, kind, and tags become a canonical text document.
          Four fixed frames from the atlas become a visual caption. Each branch
          is embedded separately and stored as versioned derived data.
        </Text>
        <GuideFigure
          figure={searchProfile}
          kind="diagram"
          width={427}
          height={507}
        />
        <Text variant="body-2" color="secondary" className="guide-section-copy">
          Every stored vector carries its model revision, dimension count, and
          source hash. When the card or atlas changes, an embedding built from
          older content is excluded until a fresh one is ready.
        </Text>
      </section>

      <section className="page-section guide-visual-section">
        <Text variant="display-1" as="h2">
          Online hybrid search
        </Text>
        <blockquote className="guide-query-callout">
          <span>Example query</span>
          <strong>an anxious brown bear from an old cartoon</strong>
        </blockquote>
        <Text variant="body-2" color="secondary" className="guide-section-copy">
          Hard kind, tag, and author filters run first. The remaining pets are
          ranked lexically and by text and visual similarity. Weighted
          reciprocal rank fusion combines their positions instead of comparing
          incompatible raw scores.
        </Text>
        <GuideFigure
          figure={onlineSearch}
          kind="diagram"
          width={555}
          height={609}
        />
        <GuideFigure
          figure={winnieSearch}
          kind="screenshot"
          width={1160}
          height={489}
        />
        <Text variant="body-2" color="secondary" className="guide-section-copy">
          If the embedding model or vector lookup times out, the request returns
          lexical results instead of failing the gallery.
        </Text>
      </section>

      <section className="page-section guide-visual-section">
        <Text variant="display-1" as="h2">
          Related pets without half-published results
        </Text>
        <Text variant="body-2" color="secondary" className="guide-section-copy">
          Related pets reuse current metadata, text vectors, and visual vectors,
          but ranking happens in the background. Every approved pet is compared
          with the catalog and written into a new snapshot generation.
        </Text>
        <GuideFigure
          figure={relatedGeneration}
          kind="diagram"
          width={503}
          height={842}
        />
        <GuideFigure
          figure={winnieRelated}
          kind="screenshot"
          width={1160}
          height={408}
        />
        <Text variant="body-2" color="secondary" className="guide-section-copy">
          One transaction activates the generation only after every expected
          row is current and valid. While the related-pets state is building or
          failed, the detail page uses the heuristic order. The previous snapshot
          remains stored and recoverable, but it is not served until the state
          becomes ready again.
        </Text>
      </section>

      <section
        className="page-section guide-visual-summary"
        aria-labelledby="guide-summary-title"
      >
        <Text variant="display-1" as="h2" id="guide-summary-title">
          The short version
        </Text>
        <div className="guide-summary-grid">
          <article>
            <Text variant="subheader-2" as="h3">
              One data layer
            </Text>
            <Text variant="body-2" color="secondary">
              YDB stores source cards, binary assets, versioned embeddings, and
              published related-pet snapshots.
            </Text>
          </article>
          <article>
            <Text variant="subheader-2" as="h3">
              Traceable derived data
            </Text>
            <Text variant="body-2" color="secondary">
              Model revisions and source hashes keep embeddings aligned with the
              current pet pack.
            </Text>
          </article>
          <article>
            <Text variant="subheader-2" as="h3">
              Two ranking paths
            </Text>
            <Text variant="body-2" color="secondary">
              Online search ranks one current query; related pets publish one
              complete precomputed generation.
            </Text>
          </article>
        </div>
      </section>
    </Container>
  );
}

function GuideFigure({ figure, kind, width, height }: GuideFigureProps) {
  return (
    <figure
      className={`guide-figure guide-figure--${kind}`}
      data-guide-figure={kind}
    >
      <Image
        src={withBasePath(figure.src)}
        alt={figure.alt}
        width={width}
        height={height}
        className="guide-figure__image"
        unoptimized
      />
      <figcaption>{figure.caption}</figcaption>
    </figure>
  );
}
