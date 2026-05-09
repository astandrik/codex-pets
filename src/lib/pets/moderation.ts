import type { ApprovalStatus } from "@/lib/pets/types";

export type ModerationDecision = "approved" | "rejected";

export function statusAfterModeration(
  current: ApprovalStatus,
  decision: ModerationDecision,
): ApprovalStatus {
  if (current === "approved" && decision === "approved") return "approved";
  if (current === "rejected" && decision === "rejected") return "rejected";
  return decision;
}
