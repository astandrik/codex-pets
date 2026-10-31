import {randomUUID} from "node:crypto";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {MemoryStore} from "./test-store";
import {continuationFixture} from "./continuation-fixture.test-utils";
import {revisionFixture} from "./animation-revision-fixture.test-utils";

function fixture(budgetUsd = 50) {
  const store = new MemoryStore();
  const config = {now: Date.parse("2026-10-22T12:00:00Z")};
  const service = createGenerationService(store, {
    now: () => config.now, enabled: () => true, secret: () => "queue-test-secret", budgetUsd: () => budgetUsd,
  });
  return {store, service, config};
}
const input = () => ({requestId: randomUUID(), prompt: "Synthetic queue test"});
const accounting = (store: MemoryStore) => [...store.ledger].filter(([key]) => key === "budget" || key.startsWith("day:") || key.startsWith("ip:"));
const queued = (store: MemoryStore): string[] => JSON.parse(store.ledger.get("scheduler")!.value).queue;
afterEach(() => vi.unstubAllEnvs());

describe("shared generation queue capacity", () => {
  it("admits exactly 30 concurrent requests by default, with no charge or job for overflow", async () => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "");
    const f = fixture();
    const results = await Promise.allSettled(Array.from({length: 35}, (_, i) => f.service.generate(input(), `203.0.113.${i + 1}`)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(30);
    expect(results.filter(r => r.status === "rejected").map(r => r.reason.code)).toEqual(Array(5).fill("queue_full"));
    expect(queued(f.store)).toHaveLength(30);
    expect(f.store.jobs.size).toBe(30);
    expect(f.store.ledger.get("day:2026-10-22")?.value).toBe("30");
    const budget = JSON.parse(f.store.ledger.get("budget")!.value);
    expect(Object.keys(budget.reservations)).toHaveLength(30);
    expect(budget.spent).toEqual({});
  });

  it("excludes the active job and replays a UUID even when the waiting queue is full", async () => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "2");
    const f = fixture(), first = input();
    const accepted = await f.service.generate(first, "203.0.113.1");
    expect((await f.service.claim("one"))?.id).toBe(accepted.generationId);
    expect(await f.service.claim("two")).toBeNull();
    await f.service.generate(input(), "203.0.113.2");
    await f.service.generate(input(), "203.0.113.3");
    const before = structuredClone([...f.store.ledger]);
    await expect(f.service.generate(input(), "203.0.113.4")).rejects.toMatchObject({code: "queue_full"});
    expect((await f.service.generate(first, "203.0.113.1")).generationId).toBe(accepted.generationId);
    expect([...f.store.ledger]).toEqual(before);
  });

  it("keeps accepted UUIDs recoverable and does not truncate the queue when capacity is lowered", async () => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "7");
    const f = fixture(), saved = input();
    const accepted = await f.service.generate(saved, "203.0.113.1");
    for (let i = 0; i < 5; i++) await f.service.generate(input(), `203.0.113.${i + 2}`);
    const before = structuredClone([...f.store.ledger]);
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "2");
    await expect(f.service.generate(input(), "203.0.113.99")).rejects.toMatchObject({code: "queue_full"});
    expect((await f.service.generate(saved, "203.0.113.1")).generationId).toBe(accepted.generationId);
    expect([...f.store.ledger]).toEqual(before);
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "invalid");
    expect((await f.service.generate(saved, "203.0.113.1")).generationId).toBe(accepted.generationId);
    expect((await f.service.claim("existing-work"))?.id).toBe(accepted.generationId);
  });

  it.each([["1", "queue_full"], [" 7 ", "queue_full"], ["200", "rate_limited"]])("accepts the valid capacity boundary %s", async (value, refusal) => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", value);
    const f = fixture(), limit = Number(value);
    for (let i = 0; i < limit; i++) await f.service.generate(input(), `203.0.113.${i + 1}`);
    await expect(f.service.generate(input(), "198.51.100.1")).rejects.toMatchObject({code: refusal});
    expect(queued(f.store)).toHaveLength(limit);
  });

  it.each(["0", "-1", "1.5", "not-a-number", "Infinity", "201", "9007199254740992", "1e2"])("rejects invalid capacity %s without accepting work", async value => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", value);
    const f = fixture();
    await expect(f.service.generate(input(), "203.0.113.1")).rejects.toMatchObject({code: "generation_not_configured"});
    expect(f.store.jobs.size).toBe(0);
    expect(f.store.ledger.size).toBe(0);
  });
});

type Admission = "new" | "confirmation" | "revision" | "rebuild" | "regenerate";
async function admission(kind: Admission) {
  if (kind === "revision") {
    vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED", "true");
    const f = await revisionFixture();
    return {...f, submit: () => f.service.reviseAnimations(f.source.id, f.input(), "198.51.100.1")};
  }
  if (kind === "rebuild" || kind === "regenerate") {
    vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED", "true");
    const f = await continuationFixture();
    const body = await f.input(kind, kind === "regenerate" ? ["idle"] : undefined);
    return {...f, submit: () => f.service.continueGeneration(f.job.id, body, "198.51.100.1")};
  }
  const f = fixture();
  if (kind === "confirmation") {
    const accepted = await f.service.generate(input(), "198.51.100.1", {reviewBase: true});
    const job = (await f.service.claim("review"))!;
    await f.service.beginStage(job, "base");
    await f.service.saveStage(job, "base", Buffer.from("base"), {usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: 0.01}, generationMs: 1});
    await f.service.awaitConfirmation(job);
    return {...f, submit: () => f.service.confirm(accepted.generationId)};
  }
  return {...f, submit: () => f.service.generate(input(), "198.51.100.1")};
}

describe.each<Admission>(["new", "confirmation", "revision", "rebuild", "regenerate"])("%s admission", kind => {
  it("uses a configured capacity greater than the former limit of five", async () => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "7");
    const f = await admission(kind);
    for (let i = 0; i < 6; i++) await f.service.generate(input(), `203.0.113.${i + 1}`);
    await f.submit();
    expect(queued(f.store)).toHaveLength(7);
  });

  it("uses the same smaller capacity without changing jobs, spending or quota on refusal", async () => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "2");
    const f = await admission(kind);
    for (let i = 0; i < 2; i++) await f.service.generate(input(), `203.0.113.${i + 1}`);
    const before = {jobs: structuredClone([...f.store.jobs]), accounting: structuredClone(accounting(f.store)), queue: queued(f.store)};
    await expect(f.submit()).rejects.toMatchObject({code: "queue_full"});
    expect([...f.store.jobs]).toEqual(before.jobs);
    expect(accounting(f.store)).toEqual(before.accounting);
    expect(queued(f.store)).toEqual(before.queue);
  });
});

describe("queue deadline and spending protection", () => {
  it("keeps jobs queued for 59:59 and expires them at 60:00 without extending TTL or clearing unknown costs", async () => {
    const f = fixture();
    const accepted = await f.service.generate(input(), "203.0.113.1");
    const budget = JSON.parse(f.store.ledger.get("budget")!.value);
    budget.reservations[accepted.generationId].unknown = true;
    f.store.ledger.get("budget")!.value = JSON.stringify(budget);
    const counts = accounting(f.store).filter(([key]) => key !== "budget");
    f.config.now += 30 * 60_000;
    expect((await f.service.get(accepted.generationId)).status).toBe("queued");
    f.config.now += 30 * 60_000 - 1;
    expect((await f.service.get(accepted.generationId)).status).toBe("queued");
    f.config.now++;
    const expired = await f.service.get(accepted.generationId);
    expect(expired).toMatchObject({status: "failed", error: {code: "queue_timeout", message: expect.stringContaining("60-minute")}});
    expect(expired.expiresAt).toBe(accepted.expiresAt);
    expect(await f.service.claim("late")).toBeNull();
    expect(f.store.jobs.get(accepted.generationId)?.status).toBe("failed");
    expect(JSON.parse(f.store.ledger.get("budget")!.value).reservations[accepted.generationId].unknown).toBe(true);
    expect(accounting(f.store).filter(([key]) => key !== "budget")).toEqual(counts);
  });

  it("still claims a job just before the full hour", async () => {
    const f = fixture();
    const accepted = await f.service.generate(input(), "203.0.113.1");
    f.config.now += 60 * 60_000 - 1;
    expect((await f.service.claim("on-time"))?.id).toBe(accepted.generationId);
  });

  it("blocks paid stages and new admissions at the unchanged budget threshold with a larger queue", async () => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "30");
    const f = fixture(0.04);
    for (let i = 0; i < 8; i++) await f.service.generate(input(), `203.0.113.${i + 1}`);
    const first = (await f.service.claim("one"))!;
    await f.service.beginStage(first, "base");
    await f.service.saveStage(first, "base", Buffer.from("saved"), {usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: 0.04}, generationMs: 1});
    await f.service.fail(first, "provider_rejected");
    const next = (await f.service.claim("two"))!;
    const before = structuredClone(accounting(f.store));
    await expect(f.service.beginStage(next, "base")).rejects.toMatchObject({code: "budget_exhausted"});
    await expect(f.service.generate(input(), "203.0.113.99")).rejects.toMatchObject({code: "budget_exhausted"});
    expect(accounting(f.store)).toEqual(before);
    expect(f.store.jobs.size).toBe(8);
    expect(f.store.jobs.get(next.id)?.stages).toEqual([]);
  });
});
