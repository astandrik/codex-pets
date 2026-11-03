"use client";

import { useState, type ReactNode, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Button, Dialog, Text, useToaster } from "@gravity-ui/uikit";
import { TrashBin } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";

type PetDeleteActionProps = {
  petId: string;
  mode: "admin" | "owner" | null;
  renderTrigger?: (openDelete?: () => void) => ReactNode;
  returnFocus?: RefObject<HTMLButtonElement | null>;
};

export function PetDeleteAction({ petId, mode, renderTrigger, returnFocus }: PetDeleteActionProps) {
  const router = useRouter();
  const { add } = useToaster();
  const [openForId, setOpenForId] = useState<string | null>(null);
  const open = mode !== null && openForId === petId;
  const close = () => setOpenForId(null);
  const openDelete = () => setOpenForId(petId);
  const [busy, setBusy] = useState(false);

  async function deletePet() {
    if (!mode) return;
    const url =
      mode === "admin"
        ? withBasePath(`/api/admin/submissions/${petId}/delete`)
        : withBasePath(`/api/my-pets/${petId}/delete`);
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
      close();
      router.replace("/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  let trigger: ReactNode = null;
  if (renderTrigger) {
    trigger = renderTrigger(mode ? openDelete : undefined);
  } else if (mode) {
    trigger = (
      <Button view="outlined-danger" size="l" onClick={openDelete}>
        <Button.Icon>
          <TrashBin />
        </Button.Icon>
        Delete
      </Button>
    );
  }

  return (
    <>
      {trigger}
      <Dialog open={open} onClose={close} size="s" returnFocus={returnFocus} disableBodyScrollLock={!open}>
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
          onClickButtonCancel={close}
          onClickButtonApply={deletePet}
          propsButtonApply={{ view: "outlined-danger", loading: busy }}
        />
      </Dialog>
    </>
  );
}
