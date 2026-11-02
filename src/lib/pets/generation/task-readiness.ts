import type {GenerationTask, TaskScheduler} from "@/lib/pets/generation/model";

export const isProviderTask = (task: GenerationTask) => task.kind === "image" || task.kind === "metadata";
export function taskResourcesAvailable(task: GenerationTask, state: TaskScheduler) {
  if (state.pauseReason && task.kind !== "fail" && task.kind !== "package") return false;
  if (isProviderTask(task) && (state.providerSlots.length >= state.providerLimit ||
      state.tasks.filter(t => t.status === "running" && isProviderTask(t)).length >= state.providerLimit)) return false;
  return !((task.kind === "compose" || task.kind === "package") && state.heavy);
}
export function nextTaskWakeDelay(state: TaskScheduler, now: number, draining = false) {
  if (draining) return 5000;
  const ready = state.tasks.filter(t => t.status === "ready");
  const available = ready.filter(t => taskResourcesAvailable(t, state));
  if (available.length) return Math.max(50, Math.min(5000, ...available.map(t => t.notBefore - now)));
  const waitingForCapacity = ready.some(t => !state.pauseReason || t.kind === "fail" || t.kind === "package");
  return waitingForCapacity ? 500 : 5000;
}
