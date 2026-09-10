"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Checkbox,
  Dialog,
  DropdownMenu,
  Flex,
  Text,
  TextArea,
  useToaster,
} from "@gravity-ui/uikit";
import { Check, EllipsisVertical, TrashBin, Xmark } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import { pollApprovalPreparation } from "./approval-preparation-client";
import "./AdminSubmissionActions.scss";

type AdminSubmissionActionsProps = {
  petId: string;
  publicEmailRequested: boolean;
  contactEmail: string | null;
};

type DialogKind = "approve" | "reject" | "delete" | null;

export function AdminSubmissionActions({ petId, publicEmailRequested, contactEmail }: AdminSubmissionActionsProps) {
  const router = useRouter();
  const { add } = useToaster();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [reason, setReason] = useState("");
  const [publishRequestedEmail, setPublishRequestedEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [approvalPreparationId, setApprovalPreparationId] = useState<
    string | null
  >(null);

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

  function openApproveDialog() {
    setPublishRequestedEmail(false);
    setDialog("approve");
  }

  function closeApproveDialog() {
    setPublishRequestedEmail(false);
    setDialog(null);
  }

  async function approve(publishRequestedEmail = false) {
    setBusy(true);
    try {
      let preparationId = approvalPreparationId;
      if (!preparationId) {
        const response = await fetch(
          withBasePath(`/api/admin/submissions/${petId}/approve`),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publishRequestedEmail }),
          },
        );
        if (!response.ok) {
          notifyFailure("Approve", response.status);
          return;
        }
        if (response.status !== 202) {
          completeApproval();
          return;
        }
        const payload = await response.json() as { preparationId?: unknown };
        if (typeof payload.preparationId !== "string") {
          notifyFailure("Approve", 500);
          return;
        }
        preparationId = payload.preparationId;
        setApprovalPreparationId(preparationId);
        closeApproveDialog();
      }
      const url = new URL(
        withBasePath(`/api/admin/submissions/${petId}/approval-preparation`),
        window.location.origin,
      );
      url.searchParams.set("preparationId", preparationId);
      const status = await pollApprovalPreparation(url.href);
      if (status === "timeout") {
        add({
          name: `pet-mod-${petId}-preparation`,
          theme: "normal",
          title: "Approval continues in background",
          content: "Use Approve again to resume the status check.",
        });
        return;
      }
      if (status !== "succeeded") {
        setApprovalPreparationId(null);
        add({
          name: `pet-mod-${petId}-preparation`,
          theme: "danger",
          title: status === "manual_review"
            ? "Approval needs attention"
            : "Approval status check failed",
        });
        return;
      }
      setApprovalPreparationId(null);
      completeApproval();
    } finally {
      setBusy(false);
    }
  }

  function completeApproval() {
    closeApproveDialog();
    trackGoal("pet_review_approve");
    notifySuccess("Pet approved");
    router.refresh();
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
      <Button
        view="action"
        size="m"
        onClick={() => {
          if (approvalPreparationId || !publicEmailRequested) void approve();
          else openApproveDialog();
        }}
        loading={busy}
      >
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
        open={dialog === "approve"}
        onClose={closeApproveDialog}
        size="s"
      >
        <Dialog.Header caption="Approve submission" />
        <Dialog.Body>
          <Flex direction="column" gap={3}>
            <Text variant="body-2" color="secondary">
              The submitter requested publication of their full contact email.
              You can approve the pet without publishing it.
            </Text>
            <Text variant="body-2">
              {contactEmail ?? "No contact email is stored for this submission."}
            </Text>
            <Checkbox
              checked={publishRequestedEmail}
              onUpdate={setPublishRequestedEmail}
              disabled={!contactEmail || busy}
              content="I verified ownership of this address; publish it"
            />
          </Flex>
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Approve"
          textButtonCancel="Cancel"
          onClickButtonCancel={closeApproveDialog}
          onClickButtonApply={() => void approve(publishRequestedEmail)}
          propsButtonApply={{ view: "action", loading: busy }}
        />
      </Dialog>

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
