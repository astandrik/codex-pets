import {randomUUID} from "node:crypto";
import {afterEach, expect, it, vi} from "vitest";
import {createGenerationService} from "./service";
import {createQuotaAdminService} from "./quota-grants";
import {MemoryStore} from "./test-store";
import {DAY} from "./model";
import {generationHttpError} from "./http";

const secret = "synthetic-admission-clock-secret";
const ip = "203.0.113.5";
const midnight = Date.parse("2026-11-07T21:00:00Z");
afterEach(() => vi.restoreAllMocks());

function fixture(now = midnight - 1000) {
  const store = new MemoryStore(), clock = {now};
  const options = {secret: () => secret, now: () => clock.now};
  const service = createGenerationService(store, {...options, enabled: () => true});
  const admin = createQuotaAdminService(store, options);
  const input = () => ({requestId: randomUUID(), prompt: "Synthetic character"});
  return {store, clock, service, admin, input};
}
async function holdTransaction(store: MemoryStore) {
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => {release = resolve;});
  const started = new Promise<void>(resolve => {entered = resolve;});
  const running = store.transaction(async () => {entered(); await gate;});
  await started;
  return {release, running};
}
const snapshot = (store: MemoryStore) => structuredClone({jobs:[...store.jobs],ledger:[...store.ledger],artifacts:[...store.artifacts]});

it("rejects an expired UUID replay after FIFO waiting without changing receipts or accounting", async () => {
  const f = fixture(), input = f.input();
  const accepted = await f.service.generate(input, ip);
  const deadline = Date.parse(accepted.expiresAt);
  f.clock.now = deadline - 1;
  const before = snapshot(f.store), held = await holdTransaction(f.store);
  const result = f.service.generate(input, ip).then(value => ({value, error: undefined}), error => ({value: undefined, error}));
  f.clock.now = deadline + 1; held.release(); await held.running;
  const response = await result;
  expect(response.error).toMatchObject({code:"generation_expired"});
  expect(generationHttpError(response.error, true).status).toBe(410);
  expect(snapshot(f.store)).toEqual(before);
});

it("preserves a live UUID, original timestamps and counters after waiting", async () => {
  const f = fixture(), input = f.input();
  const accepted = await f.service.generate(input, ip), before = snapshot(f.store);
  const held = await holdTransaction(f.store);
  const result = f.service.generate(input, ip);
  f.clock.now += 3600000; held.release(); await held.running;
  expect(await result).toEqual(accepted);
  expect(snapshot(f.store)).toEqual(before);
});

it("uses the current quota day and admission time for a new request after waiting", async () => {
  const f = fixture(midnight - 1);
  await f.service.generate(f.input(), ip);
  const budget = JSON.parse(f.store.ledger.get("budget")!.value);
  budget.spent["2026-11-06"] = 123456;
  budget.reservations.historical = {remainingMicroUsd:0, unknown:true};
  f.store.ledger.get("budget")!.value = JSON.stringify(budget);
  const held = await holdTransaction(f.store), input = f.input();
  const result = f.service.generate(input, ip);
  f.clock.now = midnight + 1; held.release(); await held.running;
  const accepted = await result;
  expect(accepted.createdAt).toBe(new Date(f.clock.now).toISOString());
  expect(accepted.expiresAt).toBe(new Date(f.clock.now + DAY).toISOString());
  expect(f.store.ledger.get("day:2026-11-07")?.value).toBe("1");
  expect(f.store.ledger.get("day:2026-11-08")?.value).toBe("1");
  const afterBudget = JSON.parse(f.store.ledger.get("budget")!.value);
  expect(afterBudget.spent).toEqual(budget.spent);
  expect(afterBudget.reservations.historical).toEqual(budget.reservations.historical);
  const beforeReplay = snapshot(f.store);
  expect((await f.service.generate(input, ip)).generationId).toBe(accepted.generationId);
  expect(snapshot(f.store)).toEqual(beforeReplay);
});

it("rechecks UUID expiry after reading the saved job", async () => {
  const f = fixture(), input = f.input();
  const accepted = await f.service.generate(input, ip), before = snapshot(f.store);
  const deadline = Date.parse(accepted.expiresAt); f.clock.now = deadline - 1;
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getJob: async id => {const job = await tx.getJob(id); f.clock.now = deadline + 1; return job;},
  })));
  await expect(f.service.generate(input, ip)).rejects.toMatchObject({code:"generation_expired"});
  expect(snapshot(f.store)).toEqual(before);
});

it("rejects a new quota grant after FIFO waiting crosses Moscow midnight", async () => {
  const f = fixture(midnight - 1), before = snapshot(f.store), held = await holdTransaction(f.store);
  const input = {requestId:randomUUID(),ip,amount:2,day:"2026-11-07"};
  const result = f.admin.grant(input, "synthetic-admin").then(value => ({value,error:undefined}), error => ({value:undefined,error}));
  f.clock.now = midnight + 1; held.release(); await held.running;
  expect((await result).error).toMatchObject({code:"quota_day_changed"});
  expect(snapshot(f.store)).toEqual(before);
});

it("inspects the current quota day after waiting", async () => {
  const f = fixture(midnight - 1);
  await f.service.generate(f.input(), ip);
  const before = snapshot(f.store), held = await holdTransaction(f.store);
  const result = f.admin.inspect(ip);
  f.clock.now = midnight + 1; held.release(); await held.running;
  expect(await result).toMatchObject({day:"2026-11-08",ipUsed:0,globalUsed:0});
  expect(snapshot(f.store)).toEqual(before);
});

it("replays an existing quota grant after midnight without a second grant or changed receipt", async () => {
  const f = fixture(midnight - 1000);
  const input = {requestId:randomUUID(),ip,amount:2,day:"2026-11-07"};
  const accepted = await f.admin.grant(input, "synthetic-admin"), before = snapshot(f.store);
  const held = await holdTransaction(f.store), result = f.admin.grant(input, "synthetic-admin");
  f.clock.now = midnight + 1; held.release(); await held.running;
  expect(await result).toEqual(accepted);
  expect(snapshot(f.store)).toEqual(before);
  await expect(f.admin.grant({...input,day:"2026-11-08"}, "synthetic-admin")).rejects.toMatchObject({code:"request_id_conflict"});
  expect(snapshot(f.store)).toEqual(before);
});

it("rejects a quota grant if midnight passes while its current allowance is read", async () => {
  const f = fixture(midnight - 1), before = snapshot(f.store);
  const transaction = f.store.transaction.bind(f.store);
  vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
    getLedger: async (key, now) => {
      const row = await tx.getLedger(key, now);
      if (key.startsWith("quota-grant:ip:")) f.clock.now = midnight + 1;
      return row;
    },
  })));
  await expect(f.admin.grant({requestId:randomUUID(),ip,amount:2,day:"2026-11-07"}, "synthetic-admin")).rejects.toMatchObject({code:"quota_day_changed"});
  expect(snapshot(f.store)).toEqual(before);
});
