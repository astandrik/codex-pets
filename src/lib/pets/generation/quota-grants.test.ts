import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryStore } from "./test-store";
import { createGenerationService } from "./service";
import { createQuotaAdminService, normalizeQuotaIp } from "./quota-grants";
import { generationDigest } from "./model";
const secret = "synthetic-secret-at-least-32-characters";
function fixture() {
  const store = new MemoryStore(); const clock = { now: Date.parse("2026-10-11T10:00:00Z") };
  const options = { secret: () => secret, now: () => clock.now };
  const admin = createQuotaAdminService(store, options);
  const generation = createGenerationService(store, { ...options, enabled: () => true });
  const input = () => ({ requestId: randomUUID(), prompt: "Synthetic character" });
  const grant = (ip = "203.0.113.5", amount = 2) => ({ ip, amount, day: "2026-10-11", requestId: randomUUID() });
  async function acceptAndFail(ip = "203.0.113.5") {
    await generation.generate(input(), ip); const job = await generation.claim("test"); await generation.fail(job!, "provider_rejected");
  }
  return { store, clock, admin, generation, input, grant, acceptAndFail };
}

describe("additional daily IP attempts", () => {
  it("adds N without resetting used attempts, global usage, budget, reservations or jobs", async () => {
    const f = fixture(); for (let i=0;i<10;i++) await f.acceptAndFail();
    await expect(f.generation.generate(f.input(), "203.0.113.5")).rejects.toMatchObject({ code:"rate_limited", limitScope:"ip" });
    const before = new Map(f.store.ledger); const jobs = structuredClone(f.store.jobs);
    const receipt = await f.admin.grant(f.grant(), "admin-test");
    expect(receipt).toMatchObject({ amount:2, totalExtra:2, expiresAt:"2026-10-11T21:00:00.000Z" });
    for (const [key,row] of before) expect(f.store.ledger.get(key)).toEqual(row);
    expect(f.store.jobs).toEqual(jobs);
    expect(await f.admin.inspect("203.0.113.5")).toMatchObject({ ipUsed:10, ipLimit:12, ipRemaining:2, globalUsed:10, globalLimit:200 });
    for (let i=0;i<2;i++) await f.acceptAndFail();
    await expect(f.generation.generate(f.input(), "203.0.113.5")).rejects.toMatchObject({ code:"rate_limited", limitScope:"ip" });
    expect(await f.admin.inspect("203.0.113.6")).toMatchObject({ ipLimit:10, ipUsed:0 });
    expect(JSON.stringify([...f.store.ledger])).not.toContain("203.0.113.5");
  });
  it("serializes same-ID grants and reconciles a lost commit response without awarding twice", async () => {
    const f=fixture(); const input=f.grant();
    const receipts=await Promise.all(Array.from({length:12},()=>f.admin.grant(input,"admin-test")));
    expect(new Set(receipts.map(r=>r.requestId)).size).toBe(1);
    expect(await f.admin.inspect(input.ip)).toMatchObject({extra:2,ipLimit:12});
    await expect(f.admin.grant({...input,amount:3},"admin-test")).rejects.toMatchObject({code:"request_id_conflict"});
    await expect(f.admin.grant(input,"different-admin")).rejects.toMatchObject({code:"request_id_conflict"});
    const lost=fixture(); const original=lost.store.transaction.bind(lost.store); let once=true;
    lost.store.transaction=async fn=>{ const result=await original(fn); if(once){once=false;throw Error("commit_ack_lost");} return result; };
    const request=lost.grant(undefined,100); await expect(lost.admin.grant(request,"admin-test")).rejects.toThrow("commit_ack_lost");
    await lost.admin.grant(request,"admin-test"); expect(await lost.admin.inspect(request.ip)).toMatchObject({extra:100,ipLimit:110});
  });
  it("serializes distinct grants with admissions and never exceeds available extra attempts", async () => {
    const f=fixture();for(let i=0;i<10;i++)await f.acceptAndFail();
    await Promise.all([f.admin.grant(f.grant(undefined,1),"admin-a"),f.admin.grant(f.grant(undefined,1),"admin-b")]);
    const outcomes=await Promise.allSettled(Array.from({length:5},()=>f.generation.generate(f.input(),"203.0.113.5")));
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(2);
    expect(await f.admin.inspect("203.0.113.5")).toMatchObject({extra:2,ipUsed:12,ipRemaining:0});
  });
  it("cannot override the service cap or monetary budget", async () => {
    const f=fixture(); await f.admin.grant(f.grant(undefined,30),"admin-test");
    f.store.ledger.set("day:2026-10-11",{value:"200",expiresAt:f.clock.now+86400000});
    await expect(f.generation.generate(f.input(),"203.0.113.5")).rejects.toMatchObject({code:"rate_limited",limitScope:"global"});
    f.store.ledger.set("day:2026-10-11",{value:"0",expiresAt:f.clock.now+86400000});
    f.store.ledger.set("budget",{value:JSON.stringify({spent:{"2026-10-11":50_000_000},reservations:{unknown:{remainingMicroUsd:1_000_000,unknown:true}}}),expiresAt:Date.UTC(2099,0)});
    const budget=f.store.ledger.get("budget");
    await expect(f.generation.generate(f.input(),"203.0.113.5")).rejects.toMatchObject({code:"budget_exhausted"});
    expect(f.store.ledger.get("budget")).toEqual(budget);
  });
  it("expires at Moscow midnight but preserves grant receipts/history and unresolved budget", async () => {
    const f=fixture();const input=f.grant();await f.admin.grant(input,"admin-test");
    f.clock.now=Date.parse("2026-10-11T21:00:00Z");
    expect(await f.admin.inspect(input.ip)).toMatchObject({day:"2026-10-12",extra:0,ipLimit:10});
    expect(await f.admin.grant(input,"admin-test")).toMatchObject({day:"2026-10-11",totalExtra:2});
    await expect(f.admin.grant({...input,requestId:randomUUID()},"admin-test")).rejects.toMatchObject({code:"quota_day_changed"});
    expect([...f.store.ledger.keys()].some(k=>k.startsWith('quota-grant:request:'))).toBe(true);
  });
  it("normalizes IPv6 and preserves consumed legacy counters instead of resetting them", async () => {
    const f=fixture();const expanded="2001:0db8:0000:0000:0000:0000:0000:0005";
    expect(normalizeQuotaIp(expanded)).toBe("2001:db8::5");
    const key="ip:2026-10-11:"+generationDigest(secret,"ip","2026-10-11:"+expanded);
    f.store.ledger.set(key,{value:"10",expiresAt:f.clock.now+86400000});
    await f.admin.grant(f.grant(expanded,1),"admin-test");
    await f.acceptAndFail(expanded);
    await expect(f.generation.generate(f.input(),"2001:db8::5")).rejects.toMatchObject({limitScope:"ip"});
    expect(Number(f.store.ledger.get(key)?.value)).toBeGreaterThanOrEqual(10);
  });
  it("adds more attempts after the old daily maximum without resetting usage", async () => {
    const f=fixture();await f.acceptAndFail();
    const old=f.grant(undefined,30);await f.admin.grant(old,"admin");
    const next=f.grant(undefined,70);const receipt=await f.admin.grant(next,"admin");
    expect(receipt).toMatchObject({amount:70,totalExtra:100});
    expect(await f.admin.grant(next,"admin")).toEqual(receipt);
    expect(await f.admin.grant(old,"admin")).toMatchObject({totalExtra:30});
    expect(await f.admin.inspect(next.ip)).toMatchObject({extra:100,ipLimit:110,ipUsed:1,ipRemaining:109,globalUsed:1,globalLimit:200});
  });
  it("retains more than thirty distinct daily grant receipts and audit events", async () => {
    const f=fixture();
    for(let i=0;i<31;i++)await f.admin.grant(f.grant(undefined,1),"admin");
    expect(await f.admin.inspect("203.0.113.5")).toMatchObject({extra:31,ipLimit:41});
    const bonus=[...f.store.ledger].find(([key])=>key.startsWith('quota-grant:ip:'))![1];
    expect(JSON.parse(bonus.value).events).toHaveLength(31);
    expect([...f.store.ledger.keys()].filter(key=>key.startsWith('quota-grant:request:'))).toHaveLength(31);
  });
  it("validates amounts and guards exact integer totals without touching counters", async () => {
    const f=fixture();
    for(const amount of [0,-1,1.2,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]) await expect(f.admin.grant(f.grant(undefined,amount),"admin")).rejects.toMatchObject({code:"invalid_argument"});
    for(const ip of ["1.2.3.4/24","https://1.2.3.4","1.2.3.4,5.6.7.8","fe80::1%eth0","127.01.2.3"])await expect(f.admin.inspect(ip)).rejects.toMatchObject({code:"invalid_argument"});
    await f.admin.grant(f.grant(undefined,Number.MAX_SAFE_INTEGER-10),"admin");
    expect(await f.admin.inspect("203.0.113.5")).toMatchObject({ipLimit:Number.MAX_SAFE_INTEGER});
    const before=structuredClone(f.store.ledger);
    await expect(f.admin.grant(f.grant(undefined,1),"admin")).rejects.toMatchObject({code:"quota_grant_limit"});
    expect(f.store.ledger).toEqual(before);
    expect(f.store.jobs.size).toBe(0);expect(f.store.ledger.has('budget')).toBe(false);
  });
});
