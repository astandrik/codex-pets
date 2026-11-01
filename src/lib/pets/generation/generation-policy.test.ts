import {randomUUID} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import * as model from "./model";
import {createGenerationService} from "./service";
import {createQuotaAdminService, readDailyQuota} from "./quota-grants";
import {MemoryStore} from "./test-store";

const now = Date.parse("2026-11-01T12:00:00Z");
const day = "2026-11-01";
const secret = "relaxed-generation-policy-test-secret";
const ip = "203.0.113.10";
const input = () => ({requestId: randomUUID(), prompt: "A tiny orange cat"});
function fixture(budgetUsd?: () => number | null) {
  const store = new MemoryStore();
  const service = createGenerationService(store, {enabled: () => true, secret: () => secret, now: () => now, ...(budgetUsd ? {budgetUsd} : {})});
  const quota = () => store.transaction(tx => readDailyQuota(tx, secret, ip, now));
  return {store, service, quota};
}
function used(store: MemoryStore, global: number, perIp: number) {
  store.ledger.set(`day:${day}`, {value: String(global), expiresAt: now + model.DAY});
  store.ledger.set(`ip:${day}:${model.generationDigest(secret, "ip", `${day}:${ip}`)}`, {value: String(perIp), expiresAt: now + model.DAY});
}
beforeEach(() => {
  vi.stubEnv("PET_GENERATION_DAILY_IP_LIMIT", "");
  vi.stubEnv("PET_GENERATION_DAILY_GLOBAL_LIMIT", "");
  vi.stubEnv("PET_GENERATION_BUDGET_USD", "");
  vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "30");
});
afterEach(() => vi.unstubAllEnvs());

describe("relaxed daily allowances", () => {
  it("accepts the hundredth IP task and rejects the next without changing accounting", async () => {
    const f = fixture(); used(f.store, 99, 99);
    const request = input();
    const accepted = await f.service.generate(request, ip);
    expect(await f.quota()).toMatchObject({ipLimit: 100, ipUsed: 100, ipRemaining: 0, globalLimit: 2000});
    const before = structuredClone([...f.store.ledger]);
    await expect(f.service.generate(input(), ip)).rejects.toMatchObject({code: "rate_limited", limitScope: "ip"});
    expect((await f.service.generate(request, ip)).generationId).toBe(accepted.generationId);
    expect([...f.store.ledger]).toEqual(before);
    expect(f.store.jobs.size).toBe(1);
  });

  it("accepts the two-thousandth global task and rejects another IP afterward", async () => {
    const f = fixture(); used(f.store, 1999, 0);
    await f.service.generate(input(), ip);
    expect(await f.quota()).toMatchObject({globalLimit: 2000, globalUsed: 2000, globalRemaining: 0});
    await expect(f.service.generate(input(), "203.0.113.11")).rejects.toMatchObject({code: "rate_limited", limitScope: "global"});
    expect(f.store.jobs.size).toBe(1);
  });

  it("uses configured allowances in admission and administrative inspection", async () => {
    vi.stubEnv("PET_GENERATION_DAILY_IP_LIMIT", "3");
    vi.stubEnv("PET_GENERATION_DAILY_GLOBAL_LIMIT", "5");
    const f = fixture(); used(f.store, 4, 2);
    await f.service.generate(input(), ip);
    const admin = createQuotaAdminService(f.store, {secret: () => secret, now: () => now});
    expect(await admin.inspect(ip)).toMatchObject({ipLimit: 3, ipUsed: 3, globalLimit: 5, globalUsed: 5});
    await expect(f.service.generate(input(), "203.0.113.11")).rejects.toMatchObject({code: "rate_limited", limitScope: "global"});
  });

  it.each([
    ["PET_GENERATION_DAILY_IP_LIMIT", "0"], ["PET_GENERATION_DAILY_IP_LIMIT", "-1"],
    ["PET_GENERATION_DAILY_IP_LIMIT", "1.5"], ["PET_GENERATION_DAILY_IP_LIMIT", "Infinity"],
    ["PET_GENERATION_DAILY_IP_LIMIT", "invalid"], ["PET_GENERATION_DAILY_IP_LIMIT", "1e2"],
    ["PET_GENERATION_DAILY_IP_LIMIT", "9007199254740992"], ["PET_GENERATION_DAILY_GLOBAL_LIMIT", "invalid"],
  ])("rejects malformed %s=%s without writes, while saved UUIDs still replay", async (setting, value) => {
    const f = fixture(), request = input();
    const accepted = await f.service.generate(request, ip);
    const before = structuredClone([...f.store.ledger]);
    vi.stubEnv(setting, value);
    await expect(f.service.generate(input(), ip)).rejects.toMatchObject({code: "generation_not_configured"});
    expect((await f.service.generate(request, ip)).generationId).toBe(accepted.generationId);
    expect([...f.store.ledger]).toEqual(before);
    expect(f.store.jobs.size).toBe(1);
  });

  it("keeps historical large grant receipts readable and the effective limit a safe integer", async () => {
    const f = fixture();
    const extra = Number.MAX_SAFE_INTEGER - 10;
    const key = `quota-grant:ip:${day}:${model.generationDigest(secret, "ip", `${day}:${ip}`)}`;
    f.store.ledger.set(key, {value: JSON.stringify({extra, events: []}), expiresAt: now + model.DAY});
    expect(await f.quota()).toMatchObject({extra, ipLimit: Number.MAX_SAFE_INTEGER, ipRemaining: Number.MAX_SAFE_INTEGER});
    const admin = createQuotaAdminService(f.store, {secret: () => secret, now: () => now});
    await expect(admin.grant({ip, amount: 1, day, requestId: randomUUID()}, "admin-test")).rejects.toMatchObject({code: "quota_grant_limit"});
  });
});

describe("optional recorded-spend threshold", () => {
  it.each([undefined, "", " ", "0", "0.0"])("disables the threshold for configuration %s", value => {
    if (value === undefined) delete process.env.PET_GENERATION_BUDGET_USD;
    else vi.stubEnv("PET_GENERATION_BUDGET_USD", value);
    expect(model.generationBudgetLimit()).toBeNull();
  });

  it.each(["50", "100", "250.5"])("keeps explicit positive threshold %s", value => {
    vi.stubEnv("PET_GENERATION_BUDGET_USD", value);
    expect(model.generationBudgetLimit()).toBe(Number(value));
  });

  it.each(["-1", "NaN", "Infinity", "invalid"])("rejects malformed threshold %s", value => {
    vi.stubEnv("PET_GENERATION_BUDGET_USD", value);
    expect(() => model.generationBudgetLimit()).toThrowError(expect.objectContaining({code: "generation_not_configured"}));
  });

  it("accepts and runs above the former $50 threshold without discarding recorded or unknown costs", async () => {
    const f = fixture();
    const unknown = {remainingMicroUsd: 0, unknown: true};
    f.store.ledger.set("budget", {value: JSON.stringify({spent: {[day]: 500_000_000}, reservations: {historical: unknown}}), expiresAt: Date.UTC(2099, 0)});
    const request = input();
    const accepted = await f.service.generate(request, ip);
    const job = (await f.service.claim("policy-test"))!;
    await f.service.beginStage(job, "base");
    await f.service.saveStage(job, "base", Buffer.from("base"), {usage: {textInputTokens: 1, imageInputTokens: 0, outputTokens: 1, costUsd: 1}, generationMs: 1});
    expect(JSON.parse(f.store.ledger.get("budget")!.value)).toMatchObject({spent: {[day]: 501_000_000}, reservations: {historical: unknown}});
    const before = structuredClone([...f.store.ledger]);
    expect((await f.service.generate(request, ip)).generationId).toBe(accepted.generationId);
    expect([...f.store.ledger]).toEqual(before);
  });

  it("still enforces an explicitly configured threshold before a provider stage", async () => {
    const f = fixture(() => 100);
    const accepted = await f.service.generate(input(), ip);
    const job = (await f.service.claim("policy-test"))!;
    const budget = JSON.parse(f.store.ledger.get("budget")!.value);
    budget.spent[day] = 100_000_000;
    f.store.ledger.get("budget")!.value = JSON.stringify(budget);
    await expect(f.service.beginStage(job, "base")).rejects.toMatchObject({code: "budget_exhausted"});
    expect(f.store.jobs.get(accepted.generationId)?.stages).toEqual([]);
  });

  it("checks an accepted UUID before a subsequently invalid budget setting", async () => {
    const f = fixture(model.generationBudgetLimit), request = input();
    const accepted = await f.service.generate(request, ip);
    const before = structuredClone([...f.store.ledger]);
    vi.stubEnv("PET_GENERATION_BUDGET_USD", "invalid");
    expect((await f.service.generate(request, ip)).generationId).toBe(accepted.generationId);
    await expect(f.service.generate(input(), ip)).rejects.toMatchObject({code: "generation_not_configured"});
    expect([...f.store.ledger]).toEqual(before);
    expect(f.store.jobs.size).toBe(1);
  });
});
