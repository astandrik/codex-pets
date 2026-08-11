"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DropdownMenu,
  Text,
  TextArea,
  useToaster,
} from "@gravity-ui/uikit";
import { Check, EllipsisVertical, TrashBin, Xmark } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import "./AdminSubmissionActions.scss";

type AdminSubmissionActionsProps = {
  petId: string;
};

type DialogKind = "reject" | "delete" | null;

export function AdminSubmissionActions({ petId }: AdminSubmissionActionsProps) {
  const router = useRouter();
  const { add } = useToaster();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  function notifyFailure(action: string, status: number) {
    add({
      name: `pet-mod-${petId}-${action}`,
      theme: "danger",
      title: `${action} failed`,
      content: `Status ${status}`,
    });
  }

  function notifySuccess(title: string) {
    add({
      name: `pet-mod-${petId}-${title}`,
      theme: "success",
      title,
    });
  }

  async function approve() {
    setBusy(true);
    try {
      const response = await fetch(
        withBasePath(`/api/admin/submissions/${petId}/approve`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: "" }),
        },
      );
      if (!response.ok) {
        notifyFailure("Approve", response.status);
        return;
      }
      if (response.status === 202) {
        const payload = await response.json() as { preparationId?: unknown };
        if (typeof payload.preparationId !== "string") {
          notifyFailure("Approve", 500);
          return;
        }
        const status = await waitForApprovalPreparation(payload.preparationId);
        if (status !== "succeeded") {
          add({
            name: `pet-mod-${petId}-preparation`,
            theme: "danger",
            title: status === "manual_review"
              ? "Approval needs attention"
              : "Approval preparation timed out",
          });
          return;
        }
      }
      trackGoal("pet_review_approve");
      notifySuccess("Pet approved");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function waitForApprovalPreparation(
    preparationId: string,
  ): Promise<"succeeded" | "manual_review" | "timeout"> {
    for (let attempt = 0; attempt < 150; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      const url = new URL(
        withBasePath(`/api/admin/submissions/${petId}/approval-preparation`),
        window.location.origin,
      );
      url.searchParams.set("preparationId", preparationId);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      const payload = await response.json() as { status?: unknown };
      if (payload.status === "succeeded") return "succeeded";
      if (payload.status === "manual_review") return "manual_review";
    }
    return "timeout";
  }

  async function reject() {
    setBusy(true);
    try {
      const response = await fetch(
        withBasePath(`/api/admin/submissions/${petId}/reject`),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason }),
        },
      );
      if (!response.ok) {
        notifyFailure("Reject", response.status);
        return;
      }
      trackGoal("pet_review_reject");
      notifySuccess("Pet rejected");
      setDialog(null);
      setReason("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function deletePet() {
    setBusy(true);
    try {
      const response = await fetch(
        withBasePath(`/api/admin/submissions/${petId}/delete`),
        { method: "POST" },
      );
      if (!response.ok) {
        notifyFailure("Delete", response.status);
        return;
      }
      trackGoal("pet_review_delete");
      notifySuccess("Pet deleted");
      setDialog(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-actions">
      <Button view="action" size="m" onClick={approve} loading={busy}>
        <Check />
        Approve
      </Button>
      <DropdownMenu
        renderSwitcher={(props) => (
          <Button {...props} view="outlined" size="m" aria-label="More actions">
            <EllipsisVertical />
          </Button>
        )}
        items={[
          {
            text: "Reject…",
            iconStart: <Xmark />,
            action: () => setDialog("reject"),
          },
          {
            text: "Delete…",
            iconStart: <TrashBin />,
            theme: "danger",
            action: () => setDialog("delete"),
          },
        ]}
      />

      <Dialog
        open={dialog === "reject"}
        onClose={() => setDialog(null)}
        size="s"
      >
        <Dialog.Header caption="Reject submission" />
        <Dialog.Body>
          <Text variant="body-2" color="secondary" className="admin-actions__hint">
            Optional reason — shown to the submitter.
          </Text>
          <TextArea
            value={reason}
            onUpdate={setReason}
            placeholder="What needs to change?"
            minRows={3}
            size="l"
          />
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Reject"
          textButtonCancel="Cancel"
          onClickButtonCancel={() => setDialog(null)}
          onClickButtonApply={reject}
          propsButtonApply={{ view: "outlined-danger", loading: busy }}
        />
      </Dialog>

      <Dialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        size="s"
      >
        <Dialog.Header caption="Delete this pet?" />
        <Dialog.Body>
          <Text variant="body-2">
            The pet will be removed from public listings and the system. This
            action cannot be undone from the UI.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Delete"
          textButtonCancel="Cancel"
          onClickButtonCancel={() => setDialog(null)}
          onClickButtonApply={deletePet}
          propsButtonApply={{ view: "outlined-danger", loading: busy }}
        />
      </Dialog>
    </div>
  );
}
