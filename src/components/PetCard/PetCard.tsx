import Link from "next/link";
import Image from "next/image";
import type { CSSProperties } from "react";
import { Card, Flex, Label, Text } from "@/components/GravityUI/GravityUI";
import { ArrowRight } from "@gravity-ui/icons";

import { InstallCommandButton } from "@/components/InstallCommand/InstallCommandButton";
import { PetCardMetrics } from "@/components/PetCard/PetCardMetrics";
import { getPetIdleStripUrl } from "@/lib/pets/asset-urls";
import { kindLabelTheme, statusLabelText, statusLabelTheme } from "@/lib/ui/labels";
import { PET_SHEET, PET_STATES } from "@/lib/pets/types";
import type { PublicPetSummary } from "@/lib/pets/types";
import "./PetCard.scss";

type PetCardProps = {
  pet: PublicPetSummary;
  showStatus?: boolean;
};

type StripStyle = CSSProperties & {
  "--pet-card-frame-count": number;
  "--pet-card-frame-duration": string;
  "--pet-card-strip-end": string;
  "--pet-card-strip-width": string;
};

const PREVIEW_STATE = PET_STATES[0];
const PREVIEW_FRAME_MS = 140;
const PREVIEW_FRAME_WIDTH = PET_SHEET.cellWidth;
const PREVIEW_FRAME_DURATION = `${PREVIEW_STATE.frames * PREVIEW_FRAME_MS}ms`;
const PREVIEW_STRIP_WIDTH = PREVIEW_FRAME_WIDTH * PREVIEW_STATE.frames;

export function PetCard({ pet, showStatus = false }: PetCardProps) {
  const authorName = pet.ownerName ?? "Anonymous";
  const authorInitial = authorName.trim().charAt(0).toUpperCase() || "U";
  const idleStripUrl = getPetIdleStripUrl(pet.spritesheetUrl);
  const stripStyle: StripStyle = {
    "--pet-card-frame-count": PREVIEW_STATE.frames,
    "--pet-card-frame-duration": PREVIEW_FRAME_DURATION,
    "--pet-card-strip-end": `-${PREVIEW_STRIP_WIDTH}px`,
    "--pet-card-strip-width": `${PREVIEW_STRIP_WIDTH}px`,
  };

  return (
    <Card view="raised" type="container" className="pet-card">
      <Link
        href={`/pets/${pet.slug}`}
        className="pet-card__overlay"
        aria-label={`View details for ${pet.displayName}`}
      />
      <div className="pet-card__sprite-wrap" aria-hidden>
        <div className="pet-card__sprite-frame">
          {idleStripUrl ? (
            <span className="pet-card__sprite-viewport" style={stripStyle}>
              <Image
                src={idleStripUrl}
                alt=""
                width={PET_SHEET.cellWidth * PREVIEW_STATE.frames}
                height={PET_SHEET.cellHeight}
                className="pet-card__sprite-strip"
                loading="lazy"
                decoding="async"
                sizes={`${PREVIEW_STRIP_WIDTH}px`}
                unoptimized
                draggable={false}
              />
            </span>
          ) : (
            <span className="pet-card__sprite-placeholder" />
          )}
        </div>
      </div>
      <Flex direction="column" gap={2} className="pet-card__body">
        <Flex gap={1} wrap className="pet-card__badges">
          <Label theme={kindLabelTheme(pet.kind)} size="s">
            {pet.kind}
          </Label>
          {showStatus ? (
            <Label theme={statusLabelTheme(pet.status)} size="s">
              {statusLabelText(pet.status)}
            </Label>
          ) : null}
        </Flex>
        <Text variant="subheader-2" as="p" ellipsis>
          {pet.displayName}
        </Text>
        <Text
          variant="caption-2"
          color="secondary"
          className="pet-card__author"
          ellipsis
        >
          <span className="pet-card__author-label">By</span>
          {pet.ownerProfileSlug ? (
            <Link
              href={`/users/${pet.ownerProfileSlug}`}
              className="pet-card__author-link"
            >
              <AuthorAvatar
                avatarUrl={pet.ownerAvatarUrl ?? null}
                initial={authorInitial}
              />
              <span className="pet-card__author-name">{authorName}</span>
            </Link>
          ) : (
            <span className="pet-card__author-static">
              <AuthorAvatar
                avatarUrl={pet.ownerAvatarUrl ?? null}
                initial={authorInitial}
              />
              <span className="pet-card__author-name">{authorName}</span>
            </span>
          )}
        </Text>
        <Text variant="body-2" color="secondary" className="pet-card__description">
          {pet.description}
        </Text>
        {pet.tags.length > 0 ? (
          <Flex gap={1} wrap className="pet-card__tags">
            {pet.tags.slice(0, 4).map((tag) => (
              <Label key={tag} theme="unknown" size="s">
                #{tag}
              </Label>
            ))}
          </Flex>
        ) : null}
        <PetCardMetrics
          slug={pet.slug}
          displayName={pet.displayName}
          status={pet.status}
          likeCount={pet.likeCount}
          downloadCount={pet.downloadCount}
          installCount={pet.installCount}
        />
      </Flex>
      {pet.status === "approved" ? (
        <InstallCommandButton slug={pet.slug} surface="card" />
      ) : null}
      <span className="pet-card__details">
        View details
        <ArrowRight width={16} height={16} />
      </span>
    </Card>
  );
}

function AuthorAvatar({
  avatarUrl,
  initial,
}: {
  avatarUrl: string | null;
  initial: string;
}) {
  return avatarUrl ? (
    <Image
      className="pet-card__author-avatar"
      src={avatarUrl}
      alt=""
      width={22}
      height={22}
      unoptimized
    />
  ) : (
    <span className="pet-card__author-avatar pet-card__author-avatar_fallback">
      {initial}
    </span>
  );
}
