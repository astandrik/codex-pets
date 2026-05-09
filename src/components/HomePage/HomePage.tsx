"use client";

import {
  Button,
  Card,
  Container,
  Flex,
  PlaceholderContainer,
  Text,
} from "@gravity-ui/uikit";
import {
  ArrowDownToLine,
  ArrowRight,
  Persons,
  Picture,
  Plus,
  Star,
} from "@gravity-ui/icons";

import { GalleryFilter } from "@/components/GalleryFilter/GalleryFilter";
import { PetCard } from "@/components/PetCard/PetCard";
import { withBasePath } from "@/lib/base-path";
import type { PublicPet } from "@/lib/pets/types";

type HomePageProps = {
  pets: PublicPet[];
  q: string;
  kind: string;
};

function EmptyIcon() {
  return <Picture width={64} height={64} />;
}

export function HomePage({ pets, q, kind }: HomePageProps) {
  return (
    <Container as="main" maxWidth="xl" className="page-shell">
      <Card view="filled" type="container" className="home-hero-card">
        <Flex
          as="section"
          gap={8}
          alignItems="center"
          justifyContent="space-between"
          className="home-hero"
          wrap
        >
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
              <Button view="outlined" size="l" href="#gallery">
                Browse gallery
                <ArrowRight />
              </Button>
            </Flex>
          </Flex>
          <div className="home-hero__visual" aria-hidden>
            <div className="home-pet">
              <span className="home-pet__shine" />
              <span className="home-pet__spark home-pet__spark_one" />
              <span className="home-pet__spark home-pet__spark_two" />
              <span className="home-pet__spark home-pet__spark_three" />
              <span className="home-pet__ear home-pet__ear_left" />
              <span className="home-pet__ear home-pet__ear_right" />
              <span className="home-pet__face">
                <span className="home-pet__eye home-pet__eye_left" />
                <span className="home-pet__eye home-pet__eye_right" />
                <span className="home-pet__cheek home-pet__cheek_left" />
                <span className="home-pet__cheek home-pet__cheek_right" />
                <span className="home-pet__mouth" />
              </span>
            </div>
          </div>
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
            {pets.length} approved pets
          </span>
        </Flex>
        <GalleryFilter defaultQuery={q} defaultKind={kind} />
        {pets.length > 0 ? (
          <div className="pet-grid">
            {pets.map((pet) => (
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
              <Button view="action" href={withBasePath("/submit")}>
                <Plus />
                Submit the first pet
              </Button>
            }
          />
        )}
      </section>
    </Container>
  );
}
