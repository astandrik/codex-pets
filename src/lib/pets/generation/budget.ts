import { z } from "zod";
import { DAY, GenerationError, moscowDay, type ImageUsage, type StageName } from "@/lib/pets/generation/model";
import type { GenerationTransaction } from "@/lib/pets/generation/store";

const PERMANENT = Date.UTC(2099, 0, 1);
const budgetSchema = z.object({
  spent: z.record(z.string(), z.number().int().nonnegative()),
  reservations: z.record(z.string(), z.object({ remainingMicroUsd: z.number().int().nonnegative(), unknown: z.boolean(), inflight: z.record(z.string(), z.number().int().positive()).optional() })),
});
type Budget = z.infer<typeof budgetSchema>;
async function load(tx: GenerationTransaction, now: number): Promise<Budget> {
  const raw = await tx.getLedger("budget", now);
  return raw ? budgetSchema.parse(JSON.parse(raw)) : { spent: {}, reservations: {} };
}
function assertBelowRecordedLimit(budget: Budget, now: number, limitUsd: number) {
  // Outstanding requests are not reserved: their eventual costs may exceed this threshold.
  if ((budget.spent[moscowDay(now)] ?? 0) >= Math.floor(limitUsd * 1_000_000)) throw new GenerationError("budget_exhausted");
}
async function save(tx: GenerationTransaction, budget: Budget, now: number) {
  // Unknown-outcome accounting markers survive job expiry and midnight.
  for (const day of Object.keys(budget.spent)) if (Date.parse(day + "T00:00:00+03:00") < now - 7 * DAY) delete budget.spent[day];
  await tx.putLedger("budget", JSON.stringify(budget), PERMANENT);
}
export async function startBudgetTracking(tx: GenerationTransaction, id: string, now: number, limitUsd: number) {
  const budget = await load(tx, now);
  assertBelowRecordedLimit(budget, now, limitUsd);
  // Retain the stored shape for compatible readers; this marker holds no money.
  budget.reservations[id] ??= { remainingMicroUsd: 0, unknown: false };
  await save(tx, budget, now);
}
export async function checkStageBudget(tx: GenerationTransaction, id: string, now: number, limitUsd: number) {
  const budget = await load(tx, now);
  if (!budget.reservations[id]) throw new GenerationError("budget_exhausted");
  assertBelowRecordedLimit(budget, now, limitUsd);
}
export async function recordStageCost(tx: GenerationTransaction, id: string, now: number, usage?: Pick<ImageUsage,"costUsd">, name?: StageName | "card") {
  const budget = await load(tx, now);
  const reserve = budget.reservations[id];
  if (!reserve) return; // Legacy single-atlas records predate reservations.
  if (!usage) reserve.unknown = true;
  else {
    const microUsd = Math.ceil(usage.costUsd * 1_000_000);
    const day = moscowDay(now);
    budget.spent[day] = (budget.spent[day] ?? 0) + microUsd;
    reserve.remainingMicroUsd = 0;
    if (name && reserve.inflight) delete reserve.inflight[name];
  }
  await save(tx, budget, now);
}
export async function settleBudget(tx: GenerationTransaction, id: string, now: number, unknown = false) {
  const budget = await load(tx, now);
  const reserve = budget.reservations[id];
  if (!reserve) return;
  if (unknown) reserve.unknown = true;
  if (!reserve.unknown) delete budget.reservations[id];
  else {
    reserve.remainingMicroUsd = 0;
    delete reserve.inflight;
  }
  await save(tx, budget, now);
}
