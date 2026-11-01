import {randomUUID} from "node:crypto";
import sharp from "sharp";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";
import {DAY, WAIT_MS} from "./model";
import {normalizeGenerationReference} from "./reference-image";

afterEach(() => vi.unstubAllEnvs());

async function queuedSource() {
  const store = new MemoryStore();
  const config = {now: Date.parse("2026-11-01T12:00:00Z"), budget: 50};
  const service = createGenerationService(store, {
    now: () => config.now,
    enabled: () => true,
    baseRetries: () => true,
    reviewFlow: () => true,
    budgetUsd: () => config.budget,
    secret: () => "queue-timeout-test-secret",
  });
  const reference = await normalizeGenerationReference(await sharp({
    create: {width: 10, height: 12, channels: 4, background: "blue"},
  }).png().toBuffer(), "image/png");
  const accepted = await service.generate({requestId: randomUUID(), prompt: "Saved description", displayName: "Saved name"}, "203.0.113.8", {reviewBase: true, reference});
  const id = accepted.generationId;
  const input = async () => {
    const options = await service.getBaseRetryOptions(id);
    if ("existingGeneration" in options) throw Error("unexpected existing child");
    return {requestId: randomUUID(), mode: "saved" as const, sourceRevision: options.sourceRevision};
  };
  return {store, service, config, id, reference, input};
}

function snapshot(store: MemoryStore) {
  return structuredClone({jobs: [...store.jobs], ledger: [...store.ledger], artifacts: [...store.artifacts]});
}

it("offers a queued timeout and its saved input without writing during GETs", async () => {
  vi.stubEnv("PET_GENERATION_BASE_RETRY_ENABLED", "true");
  vi.stubEnv("PET_GENERATION_REVIEW_FLOW_ENABLED", "true");
  const f = await queuedSource();
  f.config.now += WAIT_MS + 1;
  const before = snapshot(f.store);
  const visible = await f.service.get(f.id);
  expect(visible).toMatchObject({status: "failed", error: {code: "queue_timeout"}, canRetryBase: true});
  expect(visible.pollAfterSeconds).toBeUndefined();
  expect(await f.service.getBaseRetryOptions(f.id)).toMatchObject({inputState: "saved", prompt: "Saved description", displayName: "Saved name"});
  expect(await f.service.getBaseRetryReference(f.id, f.reference.metadata.sha256)).toEqual(f.reference.bytes);
  expect(snapshot(f.store)).toEqual(before);
});

it("keeps the same revision when the worker records a timeout after options were read", async () => {
  const f = await queuedSource();
  f.config.now += WAIT_MS + 1;
  const input = await f.input();
  expect(await f.service.claim("cleanup-worker")).toBeNull();
  expect(await f.input()).toMatchObject({sourceRevision: input.sourceRevision});
  const reply = await f.service.retryBaseGeneration(f.id, input, "203.0.113.8");
  expect(reply.requestId).toBe(input.requestId);
  expect(f.store.jobs.size).toBe(2);
});

it("atomically frees the expired queue slot and preserves input, source TTL and quota accounting", async () => {
  const f = await queuedSource();
  const original = structuredClone(f.store.jobs.get(f.id)!);
  f.config.now += WAIT_MS - 1;
  const waiting = [];
  for (let i = 0; i < 4; i++) {
    waiting.push((await f.service.generate({requestId: randomUUID(), prompt: "Other pet"}, "203.0.113.9")).generationId);
  }
  f.config.now += 2;
  const input = await f.input();
  const reply = await f.service.retryBaseGeneration(f.id, input, "203.0.113.8");
  const child = f.store.jobs.get(reply.generation.generationId)!;
  expect(f.store.jobs.get(f.id)).toMatchObject({status: "failed", error: "queue_timeout", expiresAt: original.expiresAt, retryInput: original.retryInput});
  expect(child).toMatchObject({prompt: original.prompt, displayName: original.displayName, baseRetrySourceId: f.id, expiresAt: f.config.now + DAY});
  expect(await f.store.readArtifact(child.id, "reference.png", f.config.now)).toEqual(f.reference.bytes);
  expect(await f.store.readArtifact(child.id, "generation-input.json", f.config.now)).toEqual(await f.store.readArtifact(f.id, "generation-input.json", f.config.now));
  expect(JSON.parse(f.store.ledger.get("scheduler")!.value).queue).toEqual([...waiting, child.id]);
  expect(f.store.ledger.get("day:2026-11-01")?.value).toBe("6");
  expect([...f.store.ledger].filter(([key]) => key.startsWith("ip:")).map(([, value]) => value.value).sort()).toEqual(["2", "4"]);
});

it("coalesces concurrent UUIDs and recovers a lost answer without another admission", async () => {
  const f = await queuedSource();
  f.config.now += WAIT_MS + 1;
  const input = await f.input();
  const original = f.store.transaction.bind(f.store);
  let phase = 0;
  vi.spyOn(f.store, "transaction").mockImplementation(async operation => {
    if (phase === 1) { phase = 2; throw Error("receipt unavailable"); }
    const result = await original(operation);
    if (phase === 0 && f.store.jobs.size === 2) { phase = 1; throw Error("lost acknowledgement"); }
    return result;
  });
  await expect(f.service.retryBaseGeneration(f.id, input, "203.0.113.8")).rejects.toThrow("lost acknowledgement");
  const before = snapshot(f.store);
  const replies = await Promise.all([input, {...input, requestId: randomUUID()}].map(body => f.service.retryBaseGeneration(f.id, body, "203.0.113.8")));
  expect(new Set(replies.map(reply => reply.generation.generationId)).size).toBe(1);
  expect((await f.service.findBaseRetry(f.id, input.requestId)).generation.generationId).toBe(replies[0].generation.generationId);
  expect(snapshot(f.store)).toEqual(before);
});

it.each(["pause", "budget", "ip-quota", "global-quota"])("rolls back timeout cleanup and admission when blocked by %s", async gate => {
  const f = await queuedSource();
  f.config.now += WAIT_MS + 1;
  const input = await f.input();
  if (gate === "pause") {
    const scheduler = f.store.ledger.get("scheduler")!;
    scheduler.value = JSON.stringify({...JSON.parse(scheduler.value), pauseReason: "outcome_unknown"});
  }
  if (gate === "budget") f.config.budget = 0;
  if (gate === "ip-quota") for (const [key, value] of f.store.ledger) if (key.startsWith("ip:")) value.value = "10";
  if (gate === "global-quota") f.store.ledger.get("day:2026-11-01")!.value = "200";
  const before = snapshot(f.store);
  await expect(f.service.retryBaseGeneration(f.id, input, "203.0.113.8")).rejects.toMatchObject({code: gate === "pause" ? "generation_paused" : gate === "budget" ? "budget_exhausted" : "rate_limited"});
  expect(snapshot(f.store)).toEqual(before);
});

it("does not retry a source changed to an inflight stage after the options read", async () => {
  const f = await queuedSource();
  f.config.now += WAIT_MS + 1;
  const input = await f.input();
  const source = f.store.jobs.get(f.id)!;
  source.status = "generating";
  source.stages = [{name: "base", status: "inflight", startedAt: f.config.now - 2}];
  const before = snapshot(f.store);
  await expect(f.service.retryBaseGeneration(f.id, input, "203.0.113.8")).rejects.toMatchObject({code: "base_retry_unavailable"});
  expect(snapshot(f.store)).toEqual(before);
});

it("rejects an active scheduler owner even if the queued record is inconsistent", async () => {
  const f = await queuedSource();
  f.config.now += WAIT_MS + 1;
  const input = await f.input();
  const scheduler = f.store.ledger.get("scheduler")!;
  scheduler.value = JSON.stringify({...JSON.parse(scheduler.value), active: {id: f.id, owner: "worker", until: f.config.now + 10000, inflight: true}});
  const before = snapshot(f.store);
  await expect(f.service.retryBaseGeneration(f.id, input, "203.0.113.8")).rejects.toMatchObject({code: "base_retry_unavailable"});
  expect(snapshot(f.store)).toEqual(before);
});

it("rejects a live queued source and an expired source without writes", async () => {
  const f = await queuedSource();
  const before = snapshot(f.store);
  await expect(f.service.getBaseRetryOptions(f.id)).rejects.toMatchObject({code: "base_retry_unavailable"});
  f.config.now += DAY;
  await expect(f.service.getBaseRetryOptions(f.id)).rejects.toMatchObject({code: "generation_expired"});
  expect(snapshot(f.store)).toEqual(before);
});

it("preserves recorded spending and unknown charges when the old queue entry is settled", async () => {
  const f = await queuedSource();
  f.config.now += WAIT_MS + 1;
  const budget = f.store.ledger.get("budget")!;
  const stored = JSON.parse(budget.value);
  stored.spent["2026-11-01"] = 1_000_000;
  stored.reservations[f.id].unknown = true;
  budget.value = JSON.stringify(stored);
  const result = await f.service.retryBaseGeneration(f.id, await f.input(), "203.0.113.8");
  const updated = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(updated.spent).toEqual(stored.spent);
  expect(updated.reservations[f.id]).toEqual(stored.reservations[f.id]);
  expect(updated.reservations[result.generation.generationId]).toMatchObject({unknown: false});
});

it("replays midnight cleanup with the same UUID and charges only the acceptance day", async () => {
  const f = await queuedSource();
  f.config.now = Date.parse("2026-11-01T20:59:59.999Z");
  const input = await f.input();
  const transaction = f.store.transaction.bind(f.store);
  let crossed = false;
  vi.spyOn(f.store, "transaction").mockImplementation(operation => transaction(tx => operation({
    ...tx,
    getJob: async id => {
      const job = await tx.getJob(id);
      if (!crossed && job?.baseRetrySourceId === f.id) { crossed = true; f.config.now += 2; }
      return job;
    },
  })));
  const result = await f.service.retryBaseGeneration(f.id, input, "203.0.113.8");
  expect(result.requestId).toBe(input.requestId);
  expect(f.store.ledger.get("day:2026-11-01")?.value).toBe("1");
  expect(f.store.ledger.get("day:2026-11-02")?.value).toBe("1");
  expect(f.store.jobs.size).toBe(2);
  expect(f.store.jobs.get(result.generation.generationId)?.createdAt).toBe(f.config.now);
});
