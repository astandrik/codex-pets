"use client";

import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

import { storeRelatedPetAttribution } from "@/lib/metrics/related-pet-attribution";
import { trackGoal } from "@/lib/metrics/yandex";
import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";

type RelatedPetsAnalyticsProps = {
  children: ReactNode;
  sourceSlug: string;
};

const RELATED_PET_SELECTOR =
  "[data-related-pet-slug][data-related-pet-position]";

export function RelatedPetsAnalytics({
  children,
  sourceSlug,
}: RelatedPetsAnalyticsProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const seenImpressionsRef = useRef(new Set<string>());

  useEffect(() => {
    const grid = gridRef.current;
    seenImpressionsRef.current.clear();
    if (!grid || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.5) continue;

          const card = entry.target as HTMLElement;
          const targetSlug = card.dataset.relatedPetSlug;
          const position = Number(card.dataset.relatedPetPosition);
          if (
            !targetSlug ||
            !Number.isSafeInteger(position) ||
            position < 1 ||
            position > RELATED_PETS_SNAPSHOT_DEPTH
          ) {
            continue;
          }

          const impressionKey = `${targetSlug}:${position}`;
          if (seenImpressionsRef.current.has(impressionKey)) continue;

          seenImpressionsRef.current.add(impressionKey);
          observer.unobserve(card);
          trackGoal("related_pet_impression", {
            source_slug: sourceSlug,
            target_slug: targetSlug,
            position,
            surface: "pet_detail",
          });
        }
      },
      { threshold: 0.5 },
    );

    grid.querySelectorAll(RELATED_PET_SELECTOR).forEach((card) => {
      observer.observe(card);
    });
    return () => observer.disconnect();
  }, [sourceSlug]);

  function trackRelatedPetClick(event: MouseEvent<HTMLDivElement>) {
    if (!(event.target instanceof Element)) return;
    if (!event.target.closest(".pet-card__overlay")) return;

    const card = event.target.closest<HTMLElement>(RELATED_PET_SELECTOR);
    const targetSlug = card?.dataset.relatedPetSlug;
    const position = Number(card?.dataset.relatedPetPosition);
    if (
      !targetSlug ||
      !Number.isSafeInteger(position) ||
      position < 1 ||
      position > RELATED_PETS_SNAPSHOT_DEPTH
    ) {
      return;
    }

    storeRelatedPetAttribution({
      sourceSlug,
      targetSlug,
      position,
    });
    trackGoal("related_pet_click", {
      source_slug: sourceSlug,
      target_slug: targetSlug,
      position,
      surface: "pet_detail",
    });
  }

  return (
    <div
      ref={gridRef}
      className="pet-grid related-pets__grid"
      onClickCapture={trackRelatedPetClick}
    >
      {children}
    </div>
  );
}
