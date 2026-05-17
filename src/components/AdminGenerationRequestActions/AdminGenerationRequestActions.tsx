"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Dialog,
  DropdownMenu,
  Text,
  TextArea,
  TextInput,
  useToaster,
} from "@gravity-ui/uikit";
import { Check, EllipsisVertical, Link as LinkIcon, TrashBin, Xmark } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import type { GenerationRequestStatus } from "@/lib/pets/types";
import "./AdminGenerationRequestActions.scss";

type AdminGenerationRequestActionsProps = {
  requestId: string;
  status: GenerationRequestStatus;
};

type DialogKind = "fulfill" | "reject" | "delete" | null;

export function AdminGenerationRequestActions({
  requestId,
  status,
}: AdminGenerationRequestActionsProps) {
  const router = useRouter();
  const { add } = useToaster();
  const [dialog, setDialog] = useState<DialogKind>(null);
  const [petLookup, setPetLookup] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [busy, setBusy] = useState(false);

  const canStart = status === "pending";
  const canFulfill = status !== "fulfilled";
  const canReject = status !== "fulfilled" && status !== "rejected";

  function notifyFailure(action: string, statusCode: number) {
    add({
      name: `generation-request-${requestId}-${action}`,
      theme: "danger",
      title: `${action} failed`,
      content: `Status ${statusCode}`,
    });
  }

  function notifySuccess(title: string) {
    add({
      name: `generation-request-${requestId}-${title}`,
      theme: "success",
      title,
    });
  }

  async function start() {
    await postAction({
      action: "Start",
      url: withBasePath(`/api/admin/generation-requests/${requestId}/start`),
      body: { adminNote: "" },
      goal: "pet_generation_request_start",
      onSuccess: () => notifySuccess("Request in progress"),
    });
  }

  async function fulfill() {
    await postAction({
      action: "Fulfill",
      url: withBasePath(`/api/admin/generation-requests/${requestId}/fulfill`),
      body: { petLookup, adminNote },
      goal: "pet_generation_request_fulfill",
      onSuccess: () => {
        notifySuccess("Request fulfilled");
        setDialog(null);
        setPetLookup("");
        setAdminNote("");
      },
    });
  }

  async function reject() {
    await postAction({
      action: "Reject",
      url: withBasePath(`/api/admin/generation-requests/${requestId}/reject`),
      body: { adminNote },
      goal: "pet_generation_request_reject",
      onSuccess: () => {
        notifySuccess("Request rejected");
        setDialog(null);
        setAdminNote("");
      },
    });
  }

  async function deleteRequest() {
    await postAction({
      action: "Delete",
      url: withBasePath(`/api/admin/generation-requests/${requestId}/delete`),
      body: null,
      goal: "pet_generation_request_delete",
      onSuccess: () => {
        notifySuccess("Request deleted");
        setDialog(null);
      },
    });
  }

  async function postAction(input: {
    action: string;
    url: string;
    body: Record<string, unknown> | null;
    goal: string;
    onSuccess: () => void;
  }) {
    setBusy(true);
    try {
      const response = await fetch(input.url, {
        method: "POST",
        headers: input.body ? { "Content-Type": "application/json" } : undefined,
        body: input.body ? JSON.stringify(input.body) : undefined,
      });
      if (!response.ok) {
        notifyFailure(input.action, response.status);
        return;
      }
      trackGoal(input.goal);
      input.onSuccess();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-generation-request-actions">
      {canStart ? (
        <Button view="action" size="m" onClick={start} loading={busy}>
          <Check />
          Start
        </Button>
      ) : null}
      <DropdownMenu
        renderSwitcher={(props) => (
          <Button {...props} view="outlined" size="m" aria-label="More actions">
            <EllipsisVertical />
          </Button>
        )}
        items={[
          ...(canFulfill
            ? [{
                text: "Attach pet…",
                iconStart: <LinkIcon />,
                action: () => setDialog("fulfill"),
              }]
            : []),
          ...(canReject
            ? [{
                text: "Reject…",
                iconStart: <Xmark />,
                action: () => setDialog("reject"),
              }]
            : []),
          {
            text: "Delete…",
            iconStart: <TrashBin />,
            theme: "danger",
            action: () => setDialog("delete"),
          },
        ]}
      />

      <Dialog
        open={dialog === "fulfill"}
        onClose={() => setDialog(null)}
        size="s"
      >
        <Dialog.Header caption="Attach pet" />
        <Dialog.Body>
          <Text variant="body-2" color="secondary" className="admin-generation-request-actions__hint">
            Enter an existing pet slug or id.
          </Text>
          <TextInput
            value={petLookup}
            onUpdate={setPetLookup}
            placeholder="orbit-otter"
            size="l"
            hasClear
          />
          <TextArea
            value={adminNote}
            onUpdate={setAdminNote}
            placeholder="Optional note"
            minRows={3}
            size="l"
            className="admin-generation-request-actions__note"
          />
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Attach"
          textButtonCancel="Cancel"
          onClickButtonCancel={() => setDialog(null)}
          onClickButtonApply={fulfill}
          propsButtonApply={{
            view: "action",
            loading: busy,
            disabled: !petLookup.trim(),
          }}
        />
      </Dialog>

      <Dialog open={dialog === "reject"} onClose={() => setDialog(null)} size="s">
        <Dialog.Header caption="Reject request" />
        <Dialog.Body>
          <Text variant="body-2" color="secondary" className="admin-generation-request-actions__hint">
            Optional admin note.
          </Text>
          <TextArea
            value={adminNote}
            onUpdate={setAdminNote}
            placeholder="Why is this request not actionable?"
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

      <Dialog open={dialog === "delete"} onClose={() => setDialog(null)} size="s">
        <Dialog.Header caption="Delete request?" />
        <Dialog.Body>
          <Text variant="body-2">
            The request will disappear from the admin queue.
          </Text>
        </Dialog.Body>
        <Dialog.Footer
          textButtonApply="Delete"
          textButtonCancel="Cancel"
          onClickButtonCancel={() => setDialog(null)}
          onClickButtonApply={deleteRequest}
          propsButtonApply={{ view: "outlined-danger", loading: busy }}
        />
      </Dialog>
    </div>
  );
}
