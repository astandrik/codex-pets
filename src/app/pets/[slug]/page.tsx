import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import {
  Button,
  Card,
  Container,
  Flex,
  Label,
  Text,
} from "@/components/GravityUI/GravityUI";
import {
  ArrowDownToLine,
  FileText,
  FolderArrowDown,
  Picture,
} from "@gravity-ui/icons";
import { unstable_cache } from "next/cache";

import { PetDeleteGate } from "@/components/PetDeleteAction/PetDeleteGate";
import { PetBreadcrumbs } from "@/components/PetDetails/PetBreadcrumbs";
import { InstallCommandButton } from "@/components/InstallCommand/InstallCommandButton";
import { PetMetaList } from "@/components/PetDetails/PetMetaList";
import { PetLikeButton } from "@/components/PetLikeButton/PetLikeButton";
import { StatePreview } from "@/components/StatePreview/StatePreview";
import { toPublicUrl, withBasePath } from "@/lib/base-path";
import { getPetBySlug, getPetMetrics } from "@/lib/pets/repository";
import type { ApprovalStatus } from "@/lib/pets/types";
import {
  buildPageTitle,
  getBreadcrumbJsonLd,
  getOpenGraphImages,
  getPetMetadataDescription,
  getPetSocialImagePath,
  getPetJsonLd,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";
import { formatMetricCount, metricLabel } from "@/lib/ui/metrics";
import {
  kindLabelTheme,
  statusLabelText,
  statusLabelTheme,
} from "@/lib/ui/labels";
import "./pet-detail.scss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PetPageProps = {
  params: Promise<{ slug: string }>;
};

const getPetBySlugForRequest = cache(
  async (slug: string) => getPetBySlug(slug),
);

const getCachedPetMetrics = unstable_cache(
  async (slug: string) => getPetMetrics(slug),
  ["pet-page-metrics"],
  { revalidate: 60 },
);

export async function generateMetadata({
  params,
}: PetPageProps): Promise<Metadata> {
  const { slug } = await params;
  const pet = await getPetBySlugForRequest(slug);

  if (!pet || pet.status === "deleted") {
    return {
      title: "Pet not found",
      robots: {
        index: false,
        follow: false,
      },
    };
  }

  const path = `/pets/${pet.slug}`;
  const socialImageUrl = getPetSocialImagePath(pet.slug);
  const description = getPetMetadataDescription(
    pet.displayName,
    pet.kind,
    pet.description,
  );
  const petSocialImage = {
    url: socialImageUrl,
    secureUrl: toPublicUrl(socialImageUrl),
    width: 1200,
    height: 630,
    alt: `${pet.displayName} Codex pet preview`,
    type: "image/png",
  };

  return {
    title: pet.displayName,
    description,
    alternates: {
      canonical: withBasePath(path),
    },
    robots: getPetRobots(pet.status),
    openGraph: {
      type: "article",
      siteName: SITE_NAME,
      title: buildPageTitle(pet.displayName),
      description,
      url: withBasePath(path),
      images: getOpenGraphImages([petSocialImage], {
        includeFallback: false,
      }),
    },
    twitter: {
      card: "summary_large_image",
      title: buildPageTitle(pet.displayName),
      description,
      images: getTwitterImages([petSocialImage], {
        includeFallback: false,
      }),
    },
  };
}

export default async function PetPage({ params }: PetPageProps) {
  const { slug } = await params;
  const pet = await getPetBySlugForRequest(slug);
  if (!pet) notFound();
  if (pet.status === "deleted") notFound();

  const metrics = await getCachedPetMetrics(slug);
  const statusSummary = getStatusSummary(pet.status);
  const petJsonUrl = toPublicAssetUrl(pet.petJsonUrl);
  const spritesheetUrl = toPublicAssetUrl(pet.spritesheetUrl);
  const petJsonLd =
    pet.status === "approved"
      ? getPetJsonLd({
          ...pet,
          zipUrl: pet.zipUrl,
          petJsonUrl,
          spritesheetUrl,
        })
      : null;
  const breadcrumbJsonLd = getBreadcrumbJsonLd([
    { name: "Home", path: "/" },
    { name: "Gallery", path: "/" },
    { name: pet.displayName, path: `/pets/${pet.slug}` },
  ]);

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      {petJsonLd ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(petJsonLd) }}
        />
      ) : null}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />
      <PetBreadcrumbs displayName={pet.displayName} />

      <header className="pet-detail__header">
        <Flex direction="column" gap={3}>
          <Flex gap={2} wrap>
            <Label theme={kindLabelTheme(pet.kind)}>{pet.kind}</Label>
            {pet.status !== "approved" ? (
              <Label theme={statusLabelTheme(pet.status)}>
                {statusLabelText(pet.status)}
              </Label>
            ) : null}
          </Flex>
          <Text variant="display-2" as="h1">
            {pet.displayName}
          </Text>
          <Text variant="body-2" color="secondary" className="pet-detail__lead">
            {pet.description}
            {pet.status !== "approved" ? ` ${statusSummary.message}` : ""}
          </Text>
          <div className="pet-detail__metrics" aria-label="Pet metrics">
            {pet.status === "approved" ? (
              <PetLikeButton
                slug={pet.slug}
                initialLikeCount={metrics.likeCount}
              />
            ) : (
              <span className="pet-detail__metric">
                {formatMetricCount(metrics.likeCount)}{" "}
                {metricLabel(metrics.likeCount, "like")}
              </span>
            )}
            <span className="pet-detail__metric">
              <ArrowDownToLine width={16} height={16} />
              {formatMetricCount(metrics.downloadCount)}{" "}
              {metricLabel(metrics.downloadCount, "download")}
            </span>
            <span className="pet-detail__metric">
              <FolderArrowDown width={16} height={16} />
              {formatMetricCount(metrics.installCount)}{" "}
              {metricLabel(metrics.installCount, "install")}
            </span>
          </div>
          <Flex gap={3} wrap className="pet-detail__actions">
            {pet.status === "approved" ? (
              <InstallCommandButton slug={pet.slug} surface="detail" />
            ) : null}
            <Button
              view="action"
              size="l"
              href={withBasePath(`/api/pets/${pet.slug}/download`)}
            >
              <ArrowDownToLine width={18} height={18} />
              Download ZIP
            </Button>
            <Button view="outlined" size="l" href={petJsonUrl} target="_blank">
              <FileText width={18} height={18} />
              pet.json
            </Button>
            <Button view="outlined" size="l" href={spritesheetUrl} target="_blank">
              <Picture width={18} height={18} />
              spritesheet
            </Button>
            <PetDeleteGate petId={pet.id} slug={pet.slug} />
          </Flex>
        </Flex>
      </header>

      <section className="pet-detail__body">
        <Card view="raised" className="pet-detail__preview-card">
          <StatePreview spritesheetUrl={spritesheetUrl} />
        </Card>
        <Card view="raised" className="pet-detail__meta-card">
            <PetMetaList
              slug={pet.slug}
              kind={pet.kind}
              ownerName={pet.ownerName}
              createdAt={pet.createdAt}
              approvedAt={pet.approvedAt}
              tags={pet.tags}
          />
        </Card>
      </section>

      {pet.status !== "approved" ? (
        <Text variant="caption-2" color="secondary">
          {statusSummary.message}
        </Text>
      ) : null}

      <Text variant="caption-2" color="secondary" className="pet-detail__back">
        <Link href="/">← Back to gallery</Link>
      </Text>
    </Container>
  );
}

function getStatusSummary(
  status: "approved" | "pending" | "rejected" | "deleted",
): { label: string; message: string } {
  if (status === "pending") {
    return {
      label: "Pending review",
      message:
        "This pet exists and can be previewed, but it is not listed publicly until moderation is complete.",
    };
  }

  if (status === "rejected") {
    return {
      label: "Rejected",
      message:
        "This pet is not listed in the public gallery because moderation rejected it.",
    };
  }

  if (status === "deleted") {
    return {
      label: "Deleted",
      message: "This pet has been deleted by its owner.",
    };
  }

  return { label: "Approved", message: "" };
}

function getPetRobots(status: ApprovalStatus): Metadata["robots"] {
  if (status === "approved") {
    return {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1,
      },
    };
  }

  return {
    index: false,
    follow: false,
  };
}

function toPublicAssetUrl(value: string): string {
  return value.startsWith("/") ? withBasePath(value) : value;
}
