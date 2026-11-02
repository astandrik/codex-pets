import {afterEach, expect, it, vi} from "vitest";
import {MemoryStore} from "./test-store";
import {changeSchedulerState} from "./scheduler-state";

afterEach(() => vi.unstubAllEnvs());
it("dry-run does not write, activation checks the revision and downgrade preserves the queue", async () => {
  const store = new MemoryStore(), now = Date.parse("2026-11-01T10:00:00Z");
  const initial = {revision: 7, queue: ["a", "b"], active: null};
  store.ledger.set("scheduler", {value: JSON.stringify(initial), expiresAt: now + 86400000});
  const before = structuredClone(store.ledger);
  expect(await changeSchedulerState(store, {action: "activate", expectedRevision: 7, now})).toMatchObject({version: 2, activeLimit: 1});
  expect(store.ledger).toEqual(before);
  vi.stubEnv("PET_GENERATION_DRAIN", "true");
  await expect(changeSchedulerState(store, {action: "activate", expectedRevision: 6, now, apply: true})).rejects.toThrow("scheduler_conflict");
  await changeSchedulerState(store, {action: "activate", expectedRevision: 7, now, apply: true});
  expect(JSON.parse(store.ledger.get("scheduler")!.value).version).toBe(2);
  await changeSchedulerState(store, {action: "downgrade", expectedRevision: 8, now, apply: true});
  expect(JSON.parse(store.ledger.get("scheduler")!.value)).toEqual({...initial, revision: 9});
});

it("refuses downgrade with resumed work rather than resetting its queue deadline", async () => {
  const store = new MemoryStore(), now = Date.now();
  store.ledger.set("scheduler", {expiresAt: now + 86400000, value: JSON.stringify({version: 2, revision: 1, activeLimit: 2,
    queue: ["a"], active: [], resumes: {a: now + 5000}, providerSlots: [], providerWaiters: [], providerTurn: null, heavy: null})});
  await expect(changeSchedulerState(store, {action: "downgrade", expectedRevision: 1, now})).rejects.toThrow("scheduler_not_drained");
});
