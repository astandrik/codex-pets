"use client";

import { useRouter } from "next/navigation";
import { Button } from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";

type MyPetActionsProps = {
  petId: string;
};

export function MyPetActions({ petId }: MyPetActionsProps) {
  const router = useRouter();

  async function deletePet() {
    const confirmed = window.confirm(
      "Delete this pet from your account and public listings?",
    );
    if (!confirmed) return;

    const response = await fetch(withBasePath(`/api/my-pets/${petId}/delete`), {
      method: "POST",
    });

    if (!response.ok) {
      window.alert(`Delete failed: ${response.status}`);
      return;
    }

    router.refresh();
  }

  return (
    <div className="my-pet-actions">
      <Button view="outlined-danger" onClick={deletePet}>
        Delete
      </Button>
    </div>
  );
}
