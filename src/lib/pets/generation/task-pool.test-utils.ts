import {createHash, randomUUID} from "node:crypto";
import {vi} from "vitest";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";
import type {GenerationJob, StageName} from "./model";
const now = Date.parse("2026-11-01T10:00:00Z");
const bytes = Buffer.from("synthetic saved stage");
const sha256 = createHash("sha256").update(bytes).digest("hex");
function state(limit = 20) {
  return {version: 3, revision: 0, activeLimit: 2, providerLimit: limit, active: [], queue: [], resumes: {},
    providerSlots: [], providerWaiters: [], providerTurn: null, heavy: null, tasks: [], taskTurn: null};
}
export async function taskFixture(limit = 20, automaticAnimationRepair = false, budgetUsd?: number | null) {
  vi.stubEnv("PET_GENERATION_PROVIDER_CALLS", String(limit));
  const store = new MemoryStore();
  const clock = {now};
  const service = createGenerationService(store, {enabled: () => true, secret: () => "stage-pool-test-secret-at-least-32-chars", now: () => clock.now, automaticAnimationRepair: () => automaticAnimationRepair, budgetUsd: () => budgetUsd ?? null});
  const jobs: GenerationJob[] = [];
  for (let n = 0; n < 3; n++) {
    const reply = await service.generate({requestId: randomUUID(), prompt: "Synthetic pet"}, `203.0.113.${n + 1}`);
    jobs.push(store.jobs.get(reply.generationId)!);
  }
  store.ledger.set("scheduler", {value: JSON.stringify({...state(limit), queue: jobs.map(j => j.id)}), expiresAt: now + 86400000});
  function saved(index: number, names: readonly StageName[]) {
    const job = jobs[index];
    job.status = "generating";
    job.stages = names.map(name => ({name, status: "completed", startedAt: now, sha256, generationMs: 1}));
    store.jobs.set(job.id, job);
    for (const name of names) store.artifacts.set(`${job.id}:stage-${name}.png`, {bytes, expiresAt: job.expiresAt});
  }
  return {store, clock, service, jobs, saved};
}
