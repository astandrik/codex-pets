"use client";

import { useEffect, useState, type ReactNode, type RefObject } from "react";

import { PetDeleteAction } from "@/components/PetDeleteAction/PetDeleteAction";
import { withBasePath } from "@/lib/base-path";

type PetDeleteGateProps = {
  petId: string;
  slug: string;
  renderTrigger?: (openDelete?: () => void) => ReactNode;
  returnFocus?: RefObject<HTMLButtonElement | null>;
};

type PermissionResponse = {
  canOwnerDelete: boolean;
  canAdminDelete: boolean;
};

export function PetDeleteGate({ petId, slug, renderTrigger, returnFocus }: PetDeleteGateProps) {
  const [permissions, setPermissions] = useState<{ slug: string; value: PermissionResponse } | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch(
          withBasePath(`/api/pets/${slug}/permissions`),
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok) {
          return;
        }
        const nextPermissions = (await response.json()) as PermissionResponse;
        if (!controller.signal.aborted) setPermissions({ slug, value: nextPermissions });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [slug]);

  const current = permissions?.slug === slug ? permissions.value : null;
  let mode: "admin" | "owner" | null = null;
  if (current?.canAdminDelete) mode = "admin";
  else if (current?.canOwnerDelete) mode = "owner";
  return <PetDeleteAction petId={petId} mode={mode} renderTrigger={renderTrigger} returnFocus={returnFocus} />;
}
