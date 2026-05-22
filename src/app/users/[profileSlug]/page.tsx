import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Button,
  Container,
  Flex,
  Label,
  PlaceholderContainer,
  Text,
} from "@/components/GravityUI/GravityUI";
import {
  ArrowRight,
  Calendar,
  Link as LinkIcon,
  LogoGithub,
  LogoLinkedin,
  Picture,
} from "@gravity-ui/icons";

import { PetCard } from "@/components/PetCard/PetCard";
import { getPublicUserProfileBySlug } from "@/lib/auth/repository";
import { toPublicUrl, withBasePath } from "@/lib/base-path";
import { serializeJsonLd } from "@/lib/json-ld";
import { listApprovedPetsForOwner } from "@/lib/pets/repository";
import { buildPageTitle, SITE_NAME } from "@/lib/site-metadata";
import "./user-profile.scss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserPageProps = {
  params: Promise<{ profileSlug: string }>;
};

type ProfileLink = {
  label: string;
  href: string;
  icon: ReactNode;
};

function EmptyIcon() {
  return <Picture width={64} height={64} />;
}

export async function generateMetadata({
  params,
}: UserPageProps): Promise<Metadata> {
  const { profileSlug } = await params;
  const profile = await getPublicUserProfileBySlug(profileSlug);
  if (!profile) {
    return {
      title: "User not found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const path = `/users/${profile.profileSlug}`;
  const description =
    profile.bio ??
    `${profile.displayName} publishes approved Codex pet packs on ${SITE_NAME}.`;

  return {
    title: profile.displayName,
    description,
    alternates: {
      canonical: withBasePath(path),
    },
    openGraph: {
      type: "profile",
      siteName: SITE_NAME,
      title: buildPageTitle(profile.displayName),
      description,
      url: withBasePath(path),
      ...(profile.avatarUrl ? { images: [{ url: toPublicUrl(profile.avatarUrl) }] } : {}),
    },
    twitter: {
      card: "summary",
      title: buildPageTitle(profile.displayName),
      description,
    },
  };
}

export default async function UserPage({ params }: UserPageProps) {
  const { profileSlug } = await params;
  const profile = await getPublicUserProfileBySlug(profileSlug);
  if (!profile) notFound();

  const pets = await listApprovedPetsForOwner(profile.userId);
  const profileLinks: ProfileLink[] = [];
  if (profile.websiteUrl) {
    profileLinks.push({
      label: "Website",
      href: profile.websiteUrl,
      icon: <LinkIcon width={16} height={16} />,
    });
  }
  if (profile.githubUrl) {
    profileLinks.push({
      label: "GitHub",
      href: profile.githubUrl,
      icon: <LogoGithub width={16} height={16} />,
    });
  }
  if (profile.linkedinUrl) {
    profileLinks.push({
      label: "LinkedIn",
      href: profile.linkedinUrl,
      icon: <LogoLinkedin width={16} height={16} />,
    });
  }
  const sameAs = profileLinks.map((link) => link.href);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.displayName,
    url: toPublicUrl(`/users/${profile.profileSlug}`),
    ...(profile.bio ? { description: profile.bio } : {}),
    ...(profile.avatarUrl ? { image: toPublicUrl(profile.avatarUrl) } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
      />
      <header className="user-profile__hero">
        <div className="user-profile__avatar-shell">
          <div className="user-profile__avatar" aria-hidden>
            {profile.avatarUrl ? (
              <Image
                className="user-profile__avatar-image"
                src={profile.avatarUrl}
                alt=""
                width={136}
                height={136}
                unoptimized
              />
            ) : (
              profile.displayName.trim().charAt(0).toUpperCase() || "U"
            )}
          </div>
        </div>
        <div className="user-profile__content">
          <Flex direction="column" gap={3} className="user-profile__copy">
            <Label theme="info">@{profile.profileSlug}</Label>
            <Text variant="display-2" as="h1" className="user-profile__title">
              {profile.displayName}
            </Text>
            {profile.bio ? (
              <Text variant="body-2" color="secondary" className="user-profile__bio">
                {profile.bio}
              </Text>
            ) : null}
          </Flex>

          <div className="user-profile__stats" aria-label="Profile stats">
            <div className="user-profile__stat">
              <strong>{pets.length}</strong>
              <span>approved {pets.length === 1 ? "pet" : "pets"}</span>
            </div>
            <div className="user-profile__stat">
              <Calendar width={16} height={16} />
              <span>Public since {formatMemberDate(profile.createdAt)}</span>
            </div>
          </div>

          <Flex gap={2} wrap className="user-profile__links">
            {profileLinks.map((link) => (
              <Button
                key={link.href}
                view="outlined"
                href={link.href}
                target="_blank"
                rel="noreferrer"
              >
                {link.icon}
                {link.label}
              </Button>
            ))}
            <Button view="outlined" href={withBasePath("/")}>
              Browse gallery
              <ArrowRight width={16} height={16} />
            </Button>
          </Flex>
        </div>
      </header>

      <section className="page-section user-profile__pets">
        <Flex
          as="header"
          className="section-heading"
          alignItems="center"
          gap={3}
          wrap
        >
          <Text variant="display-1" as="h2">
            Pets by {profile.displayName}
          </Text>
          <span className="section-heading__badge">
            {pets.length} approved {pets.length === 1 ? "pet" : "pets"}
          </span>
        </Flex>

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
            description="Approved public pets from this user will appear here."
          />
        )}
      </section>

      <Text variant="caption-2" color="secondary" className="page-section">
        <Link href="/">Back to gallery</Link>
      </Text>
    </Container>
  );
}

function formatMemberDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "recently";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}
