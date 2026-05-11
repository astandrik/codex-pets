"use client";

import { useEffect, useState } from "react";

import { PetDeleteAction } from "@/components/PetDeleteAction/PetDeleteAction";
import { withBasePath } from "@/lib/base-path";

type PetDeleteGateProps = {
  petId: string;
  slug: string;
};

type PermissionResponse = {
  canOwnerDelete: boolean;
  canAdminDelete: boolean;
};

export function PetDeleteGate({ petId, slug }: PetDeleteGateProps) {
  const [permissions, setPermissions] = useState<PermissionResponse | null>(null);

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
        setPermissions(nextPermissions);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          return;
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [slug]);

  if (permissions?.canAdminDelete) {
    return <PetDeleteAction petId={petId} mode="admin" />;
  }

  if (permissions?.canOwnerDelete) {
    return <PetDeleteAction petId={petId} mode="owner" />;
  }

  return null;
}
