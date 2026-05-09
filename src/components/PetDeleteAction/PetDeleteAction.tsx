"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Text, useToaster } from "@gravity-ui/uikit";
import { TrashBin } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";

type PetDeleteActionProps = {
  petId: string;
  mode: "admin" | "owner";
};

export function PetDeleteAction({ petId, mode }: PetDeleteActionProps) {
  const router = useRouter();
  const { add } = useToaster();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const url =
    mode === "admin"
      ? withBasePath(`/api/admin/submissions/${petId}/delete`)
      : withBasePath(`/api/my-pets/${petId}/delete`);

  async function deletePet() {
    setBusy(true);
    try {
      const response = await fetch(url, { method: "POST" });
      if (!response.ok) {
        add({
          name: `pet-delete-${petId}`,
          theme: "danger",
          title: "Delete failed",
          content: `Status ${response.status}`,
        });
        return;
      }
      add({
        name: `pet-delete-${petId}`,
        theme: "success",
        title: "Pet deleted",
      });
      setOpen(false);
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button view="outlined-danger" size="l" onClick={() => setOpen(true)}>
        <Button.Icon>
          <TrashBin />
        </Button.Icon>
        Delete
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="s">
        <Dialog.Header caption="Delete this pet?" />
        <Dialog.Body>
          <Text variant="body-2">
            {mode === "admin"
              ? "The pet will be removed from public listings and the system. This action cannot be undone from the UI."
              : "The pet will be removed from your account and the public gallery."}
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
    </>
  );
}
