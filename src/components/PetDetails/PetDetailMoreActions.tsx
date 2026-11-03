"use client";

import { useRef } from "react";
import { Button, DropdownMenu } from "@gravity-ui/uikit";
import { EllipsisVertical, FileText, Picture, TrashBin } from "@gravity-ui/icons";
import { PetDeleteGate } from "@/components/PetDeleteAction/PetDeleteGate";

type PetDetailMoreActionsProps = {
  petId: string;
  slug: string;
  petJsonUrl: string;
  spritesheetUrl: string;
};

export function PetDetailMoreActions({ petId, slug, petJsonUrl, spritesheetUrl }: PetDetailMoreActionsProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <PetDeleteGate
      petId={petId}
      slug={slug}
      returnFocus={triggerRef}
      renderTrigger={(openDelete) => (
        <DropdownMenu
          size="l"
          renderSwitcher={(props) => (
            <Button {...props} ref={triggerRef} view="outlined" size="xl" aria-label="More pet actions">
              <EllipsisVertical width={18} height={18} />
              More
            </Button>
          )}
          items={[
            { text: "pet.json", href: petJsonUrl, target: "_blank", rel: "noopener noreferrer", iconStart: <FileText /> },
            { text: "spritesheet", href: spritesheetUrl, target: "_blank", rel: "noopener noreferrer", iconStart: <Picture /> },
            ...(openDelete ? [[{ text: "Delete…", action: openDelete, theme: "danger" as const, iconStart: <TrashBin /> }]] : []),
          ]}
        />
      )}
    />
  );
}
