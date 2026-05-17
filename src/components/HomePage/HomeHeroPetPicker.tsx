"use client";

import Image from "next/image";
import type { CSSProperties } from "react";
import { useState } from "react";
import { ArrowRight, Shuffle } from "@gravity-ui/icons";

import { Button, Flex, Label, Text } from "@/components/GravityUI/GravityUI";
import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import { getPetIdleStripUrl } from "@/lib/pets/asset-urls";
import { PET_SHEET, PET_STATES } from "@/lib/pets/types";
import type { PublicPetSummary } from "@/lib/pets/types";
import { kindLabelTheme } from "@/lib/ui/labels";
import { pickRandomHeroPetIndex } from "@/components/HomePage/home-hero-random";

export type HomeHeroPet = Pick<
  PublicPetSummary,
  "slug" | "displayName" | "description" | "kind" | "ownerName" | "spritesheetUrl"
>;

type HomeHeroPetPickerProps = {
  pets: HomeHeroPet[];
  initialIndex: number;
};

type StripStyle = CSSProperties & {
  "--home-hero-frame-count": number;
  "--home-hero-frame-duration": string;
  "--home-hero-strip-width": string;
};

const PREVIEW_STATE = PET_STATES[0];
const PREVIEW_FRAME_MS = 140;
const PREVIEW_FRAME_DURATION = `${PREVIEW_STATE.frames * PREVIEW_FRAME_MS}ms`;
const PREVIEW_STRIP_WIDTH = PET_SHEET.cellWidth * PREVIEW_STATE.frames;

export function HomeHeroPetPicker({
  pets,
  initialIndex,
}: HomeHeroPetPickerProps) {
  const [selectedIndex, setSelectedIndex] = useState(() =>
    normalizeInitialIndex(pets.length, initialIndex),
  );
  const pet = pets[selectedIndex];

  if (!pet) {
    return <FallbackHeroPet />;
  }

  const idleStripUrl = getPetIdleStripUrl(pet.spritesheetUrl);
  const stripStyle: StripStyle = {
    "--home-hero-frame-count": PREVIEW_STATE.frames,
    "--home-hero-frame-duration": PREVIEW_FRAME_DURATION,
    "--home-hero-strip-width": `${PREVIEW_STRIP_WIDTH}px`,
  };

  function handleShuffleClick() {
    const nextIndex =
      pickRandomHeroPetIndex(pets.length, selectedIndex) ?? selectedIndex;
    const nextPet = pets[nextIndex];

    if (!nextPet || nextIndex === selectedIndex) {
      return;
    }

    setSelectedIndex(nextIndex);
    trackGoal("home_hero_pet_shuffle", {
      fromSlug: pet.slug,
      toSlug: nextPet.slug,
      toKind: nextPet.kind,
      surface: "home_hero",
    });
  }

  function trackViewPetClick(trigger: "card" | "button") {
    trackGoal("home_hero_pet_view_click", {
      slug: pet.slug,
      kind: pet.kind,
      surface: "home_hero",
      trigger,
    });
  }

  return (
    <div className="home-hero-pet" aria-label="Random featured pet">
      <a
        href={withBasePath(`/pets/${pet.slug}`)}
        className="home-hero-pet__overlay"
        aria-label={`View details for ${pet.displayName}`}
        onClick={() => trackViewPetClick("card")}
      />
      <div className="home-hero-pet__stage" aria-hidden>
        {idleStripUrl ? (
          <span className="home-hero-pet__sprite-viewport" style={stripStyle}>
            <Image
              src={idleStripUrl}
              alt=""
              width={PREVIEW_STRIP_WIDTH}
              height={PET_SHEET.cellHeight}
              className="home-hero-pet__sprite-strip"
              priority
              sizes={`${PREVIEW_STRIP_WIDTH}px`}
              unoptimized
              draggable={false}
            />
          </span>
        ) : (
          <span
            className="home-hero-pet__sprite-frame"
            style={{
              backgroundImage: `url(${pet.spritesheetUrl})`,
              backgroundSize: `${PET_SHEET.columns * 100}% ${PET_SHEET.rows * 100}%`,
              backgroundPosition: "0 0",
            }}
          />
        )}
      </div>
      <Flex direction="column" gap={2} className="home-hero-pet__meta">
        <Label theme={kindLabelTheme(pet.kind)} size="s">
          {pet.kind}
        </Label>
        <Text variant="subheader-2" as="h2" className="home-hero-pet__name">
          {pet.displayName}
        </Text>
        {pet.ownerName ? (
          <Text
            variant="caption-2"
            color="secondary"
            className="home-hero-pet__author"
          >
            By {pet.ownerName}
          </Text>
        ) : null}
        <Text
          variant="body-2"
          color="secondary"
          className="home-hero-pet__description"
        >
          {pet.description}
        </Text>
      </Flex>
      <Flex gap={2} wrap justifyContent="center" className="home-hero-pet__actions">
        <Button
          view="action"
          size="m"
          onClick={handleShuffleClick}
          disabled={pets.length < 2}
        >
          <Shuffle width={16} height={16} />
          I&apos;m feeling lucky
        </Button>
        <Button
          view="outlined"
          size="m"
          href={withBasePath(`/pets/${pet.slug}`)}
          onClick={() => trackViewPetClick("button")}
        >
          View pet
          <ArrowRight width={16} height={16} />
        </Button>
      </Flex>
    </div>
  );
}

function normalizeInitialIndex(length: number, index: number): number {
  if (length <= 0) {
    return 0;
  }

  return Number.isInteger(index) && index >= 0 && index < length ? index : 0;
}

function FallbackHeroPet() {
  return (
    <div className="home-pet" aria-hidden>
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
  );
}
