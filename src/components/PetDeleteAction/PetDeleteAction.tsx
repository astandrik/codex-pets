"use client";

import { useRouter } from "next/navigation";
import { Button } from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";

type PetDeleteActionProps = {
  petId: string;
  mode: "admin" | "owner";
};

export function PetDeleteAction({ petId, mode }: PetDeleteActionProps) {
  const router = useRouter();

  async function deletePet() {
    const confirmed = window.confirm(
      mode === "admin"
        ? "Delete this pet from the system and public listings?"
        : "Delete this pet from your account and public listings?",
    );
    if (!confirmed) return;

    const url =
      mode === "admin"
        ? withBasePath(`/api/admin/submissions/${petId}/delete`)
        : withBasePath(`/api/my-pets/${petId}/delete`);

    const response = await fetch(url, {
      method: "POST",
    });

    if (!response.ok) {
      window.alert(`Delete failed: ${response.status}`);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  return (
    <Button view="outlined-danger" onClick={deletePet}>
      Delete
    </Button>
  );
}
