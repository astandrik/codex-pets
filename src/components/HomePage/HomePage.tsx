import {
  Button,
  Card,
  Container,
  Flex,
  PlaceholderContainer,
  Text,
} from "@/components/GravityUI/GravityUI";
import {
  ArrowDownToLine,
  ArrowRight,
  Persons,
  Picture,
  Plus,
  Star,
} from "@gravity-ui/icons";
import Link from "next/link";
import type { ReactNode } from "react";

import { AskAIPanel } from "@/components/AskAI/AskAIPanel";
import {
  ASK_AI_HOME,
  ASK_AI_PRODUCT_NAME,
} from "@/components/AskAI/ask-ai-content";
import { GalleryFilter } from "@/components/GalleryFilter/GalleryFilter";
import {
  HomeHeroPetPicker,
  type HomeHeroPet,
} from "@/components/HomePage/HomeHeroPetPicker";
import { PetCard } from "@/components/PetCard/PetCard";
import { withBasePath } from "@/lib/base-path";
import { pickRandomHeroPetIndex } from "@/components/HomePage/home-hero-random";
import {
  buildHomeRecommendationEntryPoints,
  HOME_HERO_PET_LIMIT,
} from "@/components/HomePage/recommendation-entry-points";
import type { PetKind, PublicPetSummary } from "@/lib/pets/types";

type HomePageProps = {
  pets: PublicPetSummary[];
  filteredPets: PublicPetSummary[];
  filteredTotal: number;
  query: string;
  kind: PetKind | "all";
  selectedTags: string[];
  suggestedTags: string[];
};

function EmptyIcon() {
  return <Picture width={64} height={64} />;
}

export function HomePage({
  pets,
  filteredPets,
  filteredTotal,
  query,
  kind,
  selectedTags,
  suggestedTags,
}: HomePageProps) {
  const heroPets = pets.slice(0, HOME_HERO_PET_LIMIT).map(toHomeHeroPet);
  const initialHeroPetIndex = pickRandomHeroPetIndex(heroPets.length) ?? 0;
  const hasActiveFilters =
    Boolean(query) || kind !== "all" || selectedTags.length > 0;
  const recommendationEntryPoints = buildHomeRecommendationEntryPoints(pets);
  const hasRecommendationEntryPoints =
    recommendationEntryPoints.styleTags.length > 0 ||
    recommendationEntryPoints.popularPets.length > 0 ||
    recommendationEntryPoints.recentPets.length > 0;

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <Card view="filled" type="container" className="home-hero-card">
        <Flex
          as="section"
          gap={8}
          alignItems="flex-start"
          justifyContent="space-between"
          className="home-hero"
          wrap
        >
          <Flex direction="column" gap={6} className="home-hero__main">
          <Flex direction="column" gap={3} className="home-hero__copy">
            <Text variant="caption-2" color="brand" className="home-hero__eyebrow">
              The Codex pet registry
            </Text>
            <Text variant="display-2" as="h1">
              Codex Pets
            </Text>
            <Text variant="body-2" color="secondary" className="home-hero__lead">
              Browse community-made animated pet packs for Codex, preview every
              animation state, and download a ZIP that drops into{" "}
              <code>~/.codex/pets/&lt;slug&gt;</code>.
            </Text>
            <Flex gap={2} wrap className="home-hero__actions">
              <Button view="action" size="l" href={withBasePath("/submit")}>
                <Plus />
                Submit a pet
              </Button>
              <Button view="outlined" size="l" href={withBasePath("/request")}>
                Request a pet
              </Button>
              <Button view="outlined" size="l" href="#gallery">
                Browse gallery
                <ArrowRight />
              </Button>
            </Flex>
          </Flex>
          <div className="home-hero__stats" aria-label="Registry highlights">
            <div className="home-hero__stat">
              <span className="home-hero__stat-icon">
                <Star />
              </span>
              <span>
                <strong>{pets.length} approved pets</strong>
                <small>and growing</small>
              </span>
            </div>
            <div className="home-hero__stat">
              <span className="home-hero__stat-icon">
                <Persons />
              </span>
              <span>
                <strong>Community-submitted</strong>
                <small>by creators like you</small>
              </span>
            </div>
            <div className="home-hero__stat">
              <span className="home-hero__stat-icon">
                <ArrowDownToLine />
              </span>
              <span>
                <strong>ZIP-ready</strong>
                <small>drop in and enjoy</small>
              </span>
            </div>
          </div>
          </Flex>
          <div className="home-hero__visual">
            <HomeHeroPetPicker
              pets={heroPets}
              initialIndex={initialHeroPetIndex}
            />
          </div>
        </Flex>
      </Card>

      <section className="page-section home-ask-ai">
        <AskAIPanel
          productName={ASK_AI_PRODUCT_NAME}
          label={ASK_AI_HOME.label}
          helperText={ASK_AI_HOME.helperText}
          prompt={ASK_AI_HOME.prompt}
          page={ASK_AI_HOME.page}
          promptVariant={ASK_AI_HOME.promptVariant}
        />
      </section>
      <section id="gallery" className="page-section home-gallery">
        <Flex
          as="header"
          className="section-heading"
          alignItems="center"
          gap={3}
          wrap
        >
          <Text variant="display-1" as="h2">
            Gallery
          </Text>
          <span className="section-heading__badge">
            {filteredTotal} approved pets
          </span>
        </Flex>
        {filteredPets.length < filteredTotal ? (
          <Text variant="body-2" color="secondary">
            Showing the first {filteredPets.length} approved pets on the
            homepage. Use search, tags, or the public manifest to inspect the
            full registry.
          </Text>
        ) : null}

        {hasRecommendationEntryPoints ? (
          <div className="home-recommendations">
            <Flex
              as="header"
              className="section-heading"
              alignItems="center"
              gap={3}
              wrap
            >
              <Text variant="subheader-2" as="h2" className="home-recommendations__title">
                Find by style
              </Text>
            </Flex>
            <div className="home-recommendations__groups">
              {recommendationEntryPoints.styleTags.length > 0 ? (
                <RecommendationGroup title="Styles">
                  {recommendationEntryPoints.styleTags.map((entry) => (
                    <Link
                      key={entry.tag}
                      href={entry.href}
                      className="home-recommendations__link"
                    >
                      #{entry.tag}
                    </Link>
                  ))}
                </RecommendationGroup>
              ) : null}
              {recommendationEntryPoints.popularPets.length > 0 ? (
                <RecommendationGroup title="Popular">
                  {recommendationEntryPoints.popularPets.map((pet) => (
                    <Link
                      key={pet.slug}
                      href={pet.href}
                      className="home-recommendations__link"
                    >
                      {pet.displayName}
                    </Link>
                  ))}
                </RecommendationGroup>
              ) : null}
              {recommendationEntryPoints.recentPets.length > 0 ? (
                <RecommendationGroup title="Recently added">
                  {recommendationEntryPoints.recentPets.map((pet) => (
                    <Link
                      key={pet.slug}
                      href={pet.href}
                      className="home-recommendations__link"
                    >
                      {pet.displayName}
                    </Link>
                  ))}
                </RecommendationGroup>
              ) : null}
            </div>
          </div>
        ) : null}

        <GalleryFilter
          defaultQuery={query}
          defaultKind={kind}
          defaultTags={selectedTags}
          suggestedTags={suggestedTags}
        />
        {filteredPets.length > 0 ? (
          <div className="pet-grid">
            {filteredPets.map((pet) => (
              <PetCard key={pet.slug} pet={pet} />
            ))}
          </div>
        ) : (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title={
              hasActiveFilters
                ? "No pets match these filters"
                : "No approved pets yet"
            }
            description={
              hasActiveFilters
                ? "Clear the filters or try a different tag combination."
                : "Submitted pets will appear here after moderation."
            }
            actions={
              <Flex gap={2} wrap>
                <Button view="action" href={withBasePath("/submit")}>
                  <Plus />
                  Submit the first pet
                </Button>
                <Button view="outlined" href={withBasePath("/request")}>
                  Request a pet
                </Button>
              </Flex>
            }
          />
        )}
      </section>
    </Container>
  );
}

function RecommendationGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="home-recommendations__group">
      <Text variant="body-2" as="h3" className="home-recommendations__group-title">
        {title}
      </Text>
      <div className="home-recommendations__links">{children}</div>
    </div>
  );
}

function toHomeHeroPet(pet: PublicPetSummary): HomeHeroPet {
  return {
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    ownerName: pet.ownerName,
    ownerProfileSlug: pet.ownerProfileSlug,
    spritesheetUrl: pet.spritesheetUrl,
  };
}
