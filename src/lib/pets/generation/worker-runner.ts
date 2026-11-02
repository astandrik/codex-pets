import {randomUUID} from "node:crypto";
import {createWorkerContext, withWorkerContext, type WorkerContext, type WorkerErrorHandler} from "@/lib/pets/generation/worker-diagnostics";

export function configuredActiveJobs(): 1 | 2 {
  const value = process.env.PET_GENERATION_ACTIVE_JOBS ?? "1";
  if (value !== "1" && value !== "2") throw new Error("Invalid PET_GENERATION_ACTIVE_JOBS");
  return value === "2" ? 2 : 1;
}

export async function runWorkerPool(options: {
  maxActiveJobs: number;
  signal: AbortSignal;
  once?: boolean;
  runOnce: (owner: string, context?: WorkerContext) => Promise<string>;
  onError?: WorkerErrorHandler;
  delay?: () => Promise<number>;
  random?: () => number;
  onResult?: (status: string) => void;
}) {
  if (!Number.isInteger(options.maxActiveJobs) || options.maxActiveJobs < 1 || options.maxActiveJobs > 22) throw new Error("Invalid worker pool size");
  async function loop() {
    let failures = 0;
    do {
      if (options.signal.aborted) break;
      let status: string;
      const owner = randomUUID(), context = createWorkerContext(owner, options.onError);
      try { status = await withWorkerContext(context, () => options.runOnce(owner, context)); }
      catch (error) { if(!context.primaryReported)context.report(error); status = "iteration_failed"; }
      failures = status === "iteration_failed" ? failures + 1 : 0;
      options.onResult?.(status);
      if (options.once || options.signal.aborted) break;
      if (status === "yielded" || status === "completed" || status === "failed") {
        await new Promise<void>(resolve => setImmediate(resolve));
        continue;
      }
      let delay = 5000;
      if (failures) {
        const base = Math.min(5000, 250 * 2 ** Math.min(failures - 1, 5));
        const jitter = Math.max(0, Math.min(1, options.random?.() ?? Math.random()));
        delay = Math.min(5000, base + Math.floor(base * jitter));
      } else {
        try { delay = Math.max(50, Math.min(5000, await options.delay?.() ?? 5000)); }
        catch { /* Retry the read later without abandoning a sibling's paid call. */ }
      }
      if (options.signal.aborted) break;
      await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); options.signal.removeEventListener("abort", finish); resolve(); };
        const timer = setTimeout(finish, delay);
        options.signal.addEventListener("abort", finish, {once: true});
        if (options.signal.aborted) finish();
      });
    } while (!options.signal.aborted);
  }
  await Promise.all(Array.from({length: options.once ? 1 : options.maxActiveJobs}, () => loop()));
}
