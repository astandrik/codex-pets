import type {
  ApprovalStatus,
  GenerationRequestStatus,
  PetKind,
} from "@/lib/pets/types";

type LabelTheme = "info" | "success" | "warning" | "danger" | "unknown" | "normal" | "utility";

export function kindLabelTheme(kind: PetKind): LabelTheme {
  if (kind === "creature") return "info";
  if (kind === "object") return "utility";
  return "normal";
}

export function statusLabelTheme(status: ApprovalStatus): LabelTheme {
  if (status === "approved") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "unknown";
}

export function statusLabelText(status: ApprovalStatus): string {
  if (status === "approved") return "Approved";
  if (status === "pending") return "Pending";
  if (status === "rejected") return "Rejected";
  return "Deleted";
}

export function generationRequestStatusLabelTheme(
  status: GenerationRequestStatus,
): LabelTheme {
  if (status === "fulfilled") return "success";
  if (status === "pending") return "warning";
  if (status === "in_progress") return "info";
  if (status === "rejected") return "danger";
  return "unknown";
}

export function generationRequestStatusLabelText(
  status: GenerationRequestStatus,
): string {
  if (status === "fulfilled") return "Fulfilled";
  if (status === "pending") return "Pending";
  if (status === "in_progress") return "In progress";
  if (status === "rejected") return "Rejected";
  return "Deleted";
}
