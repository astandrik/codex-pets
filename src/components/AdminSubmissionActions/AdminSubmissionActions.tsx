"use client";

import { useRouter } from "next/navigation";
import { Button } from "@gravity-ui/uikit";
import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import "./AdminSubmissionActions.scss";

type AdminSubmissionActionsProps = {
  petId: string;
};

export function AdminSubmissionActions({ petId }: AdminSubmissionActionsProps) {
  const router = useRouter();

  async function decide(decision: "approve" | "reject") {
    const reason =
      decision === "reject" ? window.prompt("Rejection reason") ?? "" : "";
    const response = await fetch(
      withBasePath(`/api/admin/submissions/${petId}/${decision}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      },
    );
    if (!response.ok) {
      window.alert(`Moderation failed: ${response.status}`);
      return;
    }
    trackGoal(decision === "approve" ? "pet_review_approve" : "pet_review_reject");
    router.refresh();
  }

  async function deletePet() {
    const confirmed = window.confirm(
      "Delete this pet from the system and public listings?",
    );
    if (!confirmed) return;

    const response = await fetch(withBasePath(`/api/admin/submissions/${petId}/delete`), {
      method: "POST",
    });
    if (!response.ok) {
      window.alert(`Delete failed: ${response.status}`);
      return;
    }
    trackGoal("pet_review_delete");
    router.refresh();
  }

  return (
    <div className="admin-actions">
      <Button view="action" onClick={() => decide("approve")}>
        Approve
      </Button>
      <Button view="outlined" onClick={() => decide("reject")}>
        Reject
      </Button>
      <Button view="outlined-danger" onClick={deletePet}>
        Delete
      </Button>
    </div>
  );
}
