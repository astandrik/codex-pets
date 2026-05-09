"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Text, useToaster } from "@gravity-ui/uikit";
import { TrashBin } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";

type MyPetActionsProps = {
  petId: string;
};

export function MyPetActions({ petId }: MyPetActionsProps) {
  const router = useRouter();
  const { add } = useToaster();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function deletePet() {
    setBusy(true);
    try {
      const response = await fetch(
        withBasePath(`/api/my-pets/${petId}/delete`),
        { method: "POST" },
      );

      if (!response.ok) {
        add({
          name: `my-pet-delete-${petId}`,
          theme: "danger",
          title: "Delete failed",
          content: `Status ${response.status}`,
        });
        return;
      }

      add({
        name: `my-pet-delete-${petId}`,
        theme: "success",
        title: "Pet deleted",
      });
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="my-pet-actions">
      <Button view="outlined-danger" size="m" onClick={() => setOpen(true)}>
        <TrashBin />
        Delete
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="s">
        <Dialog.Header caption="Delete this pet?" />
        <Dialog.Body>
          <Text variant="body-2">
            The pet will be removed from your account and the public gallery.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Delete"
          textButtonCancel="Cancel"
          onClickButtonCancel={() => setOpen(false)}
          onClickButtonApply={deletePet}
          propsButtonApply={{ view: "outlined-danger", loading: busy }}
        />
      </Dialog>
    </div>
  );
}
