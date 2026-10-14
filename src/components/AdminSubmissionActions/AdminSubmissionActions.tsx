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
import { useApprovalProgress } from "./useApprovalProgress";
import { ApprovalProgressPanel } from "./ApprovalProgressPanel";
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
  const [actionBusy, setBusy] = useState(false);
  const approval = useApprovalProgress(petId, closeApproveDialog, completeApproval);
  const busy = actionBusy || approval.busy;

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
          if (approval.hasRequest) void approval.resume();
          else if (!publicEmailRequested) void approval.approve();
          else openApproveDialog();
        }}
        loading={busy}
        disabled={busy || approval.progress?.phase === "succeeded"}
      >
        <Check />
        {approval.progress?.phase === "succeeded" ? "Approved" : approval.hasRequest ? "Check status" : "Approve"}
      </Button>
      {approval.progress?.phase === "manual_review" && <Button view="outlined" size="m" disabled={busy} onClick={() => {
        if (publicEmailRequested) openApproveDialog();
        else void approval.retry();
      }}>Retry approval</Button>}
      <DropdownMenu
        renderSwitcher={(props) => (
          <Button {...props} view="outlined" size="m" aria-label="More actions" disabled={busy}>
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

      {approval.progress && <ApprovalProgressPanel progress={approval.progress} />}

      <Dialog
        open={dialog === "approve"}
        onClose={closeApproveDialog}
        size="s"
      >
        <Dialog.Header caption={approval.progress?.phase === "manual_review" ? "Retry approval" : "Approve submission"} />
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
          onClickButtonApply={() => {
            if (approval.progress?.phase === "manual_review") void approval.retry(publishRequestedEmail);
            else void approval.approve(publishRequestedEmail);
          }}
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
