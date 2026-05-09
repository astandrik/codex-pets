import Link from "next/link";
import type { CSSProperties } from "react";
import { Card, Flex, Label, Text } from "@/components/GravityUI/GravityUI";
import { ArrowDownToLine, ArrowRight, Heart } from "@gravity-ui/icons";

import { kindLabelTheme, statusLabelText, statusLabelTheme } from "@/lib/ui/labels";
import { formatMetricCount, metricLabel } from "@/lib/ui/metrics";
import { PET_SHEET, PET_STATES } from "@/lib/pets/types";
import type { PublicPet } from "@/lib/pets/types";
import "./PetCard.scss";

type PetCardProps = {
  pet: PublicPet;
  showStatus?: boolean;
};

type SpriteStyle = CSSProperties & {
  "--pet-card-frame-count": number;
  "--pet-card-frame-duration": string;
  "--pet-card-frame-end": string;
};

const PREVIEW_STATE = PET_STATES[0];
const PREVIEW_FRAME_MS = 140;
const PREVIEW_FRAME_END =
  (PREVIEW_STATE.frames / (PET_SHEET.columns - 1)) * 100;
const PREVIEW_FRAME_DURATION = `${PREVIEW_STATE.frames * PREVIEW_FRAME_MS}ms`;

export function PetCard({ pet, showStatus = false }: PetCardProps) {
  const authorName = pet.ownerName ?? pet.contactEmail ?? "Anonymous";
  const spriteStyle: SpriteStyle = {
    backgroundImage: `url(${pet.spritesheetUrl})`,
    backgroundSize: `${PET_SHEET.columns * 100}% ${PET_SHEET.rows * 100}%`,
    backgroundPosition: "0% 0%",
    "--pet-card-frame-count": PREVIEW_STATE.frames,
    "--pet-card-frame-duration": PREVIEW_FRAME_DURATION,
    "--pet-card-frame-end": `${PREVIEW_FRAME_END}%`,
  };

  return (
    <Link href={`/pets/${pet.slug}`} className="pet-card-link">
      <Card view="raised" type="container" className="pet-card">
        <div className="pet-card__sprite-wrap" aria-hidden>
          <div className="pet-card__sprite-frame">
            <div className="pet-card__sprite" style={spriteStyle} />
          </div>
        </div>
        <Flex direction="column" gap={2} className="pet-card__body">
          <Flex gap={2} wrap>
            <Label theme={kindLabelTheme(pet.kind)} size="s">
              {pet.kind}
            </Label>
            {showStatus ? (
              <Label theme={statusLabelTheme(pet.status)} size="s">
                {statusLabelText(pet.status)}
              </Label>
            ) : null}
          </Flex>
          <Text variant="subheader-2" as="h3" ellipsis>
            {pet.displayName}
          </Text>
          <Text
            variant="caption-2"
            color="secondary"
            className="pet-card__author"
            ellipsis
          >
            By {authorName}
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
          <div className="pet-card__metrics" aria-label="Pet metrics">
            <span className="pet-card__metric">
              <Heart width={16} height={16} />
              {formatMetricCount(pet.likeCount)}{" "}
              {metricLabel(pet.likeCount, "like")}
            </span>
            <span className="pet-card__metric">
              <ArrowDownToLine width={16} height={16} />
              {formatMetricCount(pet.downloadCount)}{" "}
              {metricLabel(pet.downloadCount, "download")}
            </span>
          </div>
        </Flex>
        <span className="pet-card__details">
          View details
          <ArrowRight width={16} height={16} />
        </span>
      </Card>
    </Link>
  );
}
