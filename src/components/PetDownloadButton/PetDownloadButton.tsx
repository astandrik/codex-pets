"use client";

import { ArrowDownToLine } from "@gravity-ui/icons";

import { Button } from "@/components/GravityUI/GravityUI";
import { withBasePath } from "@/lib/base-path";
import {
  getRelatedPetGoalParams,
  readRelatedPetAttribution,
} from "@/lib/metrics/related-pet-attribution";
import { trackGoal } from "@/lib/metrics/yandex";

type PetDownloadButtonProps = {
  slug: string;
};

export function PetDownloadButton({ slug }: PetDownloadButtonProps) {
  function trackDownloadClick() {
    const relatedContext = readRelatedPetAttribution(slug);
    trackGoal("pet_download_click", {
      slug,
      surface: "detail",
      ...(relatedContext ? getRelatedPetGoalParams(relatedContext) : {}),
    });
  }

  return (
    <Button
      view="action"
      size="l"
      href={withBasePath(`/api/pets/${slug}/download`)}
      onClick={trackDownloadClick}
    >
      <ArrowDownToLine width={18} height={18} />
      Download ZIP
    </Button>
  );
}
