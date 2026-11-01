import {z} from "zod";
import {CONTINUATION_STATES} from "@/lib/pets/generation/continuation-model";
import {PET_STATES} from "@/lib/pets/types";

export const animationRepairProgressSchema = z.object({
  maxAttempts: z.literal(4), phase: z.enum(["initial", "repairing", "verifying", "complete", "stopped"]),
  rows: z.array(z.object({state: z.enum(CONTINUATION_STATES), attempts: z.number().int().min(0).max(4), retrying: z.boolean()})).max(11),
  retryAt: z.iso.datetime().optional(),
});
export type AnimationRepairProgress = z.infer<typeof animationRepairProgressSchema>;

export function animationRepairProgressText(progress?: AnimationRepairProgress): string | null {
  if (!progress || progress.phase === "complete") return null;
  if (progress.phase === "stopped") return "Automatic repair stopped.";
  if (progress.phase === "verifying") return "Checking repaired animations. Saved animations are kept.";
  const rows = progress.rows.filter(row => row.retrying);
  if (!rows.length) return progress.phase === "repairing" ? "Preparing automatic repair. Saved animations are kept." : null;
  return rows.map(row => {
    const label = PET_STATES.find(state => state.key === row.state)?.label ?? (row.state === "look-0-157" ? "Gaze 1–8" : "Gaze 9–16");
    return `${label} — retry ${row.attempts - 1} of 3`;
  }).join("; ") + (progress.retryAt ? ". Waiting before the next attempt." : ".") + " Saved animations are kept.";
}
