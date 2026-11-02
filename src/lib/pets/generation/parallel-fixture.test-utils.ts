import {randomUUID} from "node:crypto";
import {vi} from "vitest";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";

export async function parallelFixture() {
  vi.stubEnv("PET_GENERATION_ACTIVE_JOBS", "2");
  const store = new MemoryStore();
  const clock = {now: Date.parse("2026-11-01T10:00:00Z")};
  const service = createGenerationService(store, {enabled: () => true,
    secret: () => "parallelism-test-secret-at-least-32-characters", now: () => clock.now,
    automaticAnimationRepair: () => true});
  const admit = () => service.generate({prompt: "Synthetic pet", requestId: randomUUID()}, "203.0.113.12");
  const a = await admit(), b = await admit(), c = await admit();
  const old = JSON.parse(store.ledger.get("scheduler")!.value);
  store.ledger.get("scheduler")!.value = JSON.stringify({...old, version: 2, activeLimit: 2,
    active: [], resumes: {}, providerSlots: [], providerWaiters: [], providerTurn: null, heavy: null});
  return {store, service, clock, admit, a, b, c};
}
