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

import { GalleryFilter } from "@/components/GalleryFilter/GalleryFilter";
import {
  HomeHeroPetPicker,
  type HomeHeroPet,
} from "@/components/HomePage/HomeHeroPetPicker";
import { PetCard } from "@/components/PetCard/PetCard";
import { withBasePath } from "@/lib/base-path";
import { pickRandomHeroPetIndex } from "@/components/HomePage/home-hero-random";
import type { PetKind, PublicPetSummary } from "@/lib/pets/types";

type HomePageProps = {
  pets: PublicPetSummary[];
  filteredPets: PublicPetSummary[];
  query: string;
  kind: PetKind | "all";
};

function EmptyIcon() {
  return <Picture width={64} height={64} />;
}

export function HomePage({ pets, filteredPets, query, kind }: HomePageProps) {
  const heroPets = pets.map(toHomeHeroPet);
  const initialHeroPetIndex = pickRandomHeroPetIndex(heroPets.length) ?? 0;

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
              Animated companions for Codex
            </Text>
            <Text variant="body-2" color="secondary" className="home-hero__lead">
              Browse community-made pet packs, preview every animation state,
              and download a ZIP that drops into{" "}
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

      <section id="gallery" className="page-section">
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
            {filteredPets.length} approved pets
          </span>
        </Flex>
        <GalleryFilter
          key={`${query}:${kind}`}
          defaultQuery={query}
          defaultKind={kind}
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
            title="No approved pets yet"
            description="Submitted pets will appear here after moderation."
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

function toHomeHeroPet(pet: PublicPetSummary): HomeHeroPet {
  return {
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    ownerName: pet.ownerName,
    spritesheetUrl: pet.spritesheetUrl,
  };
}
