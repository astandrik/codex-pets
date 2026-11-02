import {afterEach, describe, expect, it, vi} from "vitest";
import {STAGE_NAMES, schedulerSchema} from "./model";
import {taskFixture as fixture} from "./task-pool.test-utils";
afterEach(() => vi.unstubAllEnvs());
describe("stage task pool", () => {
  it("accepts v3 without changing old v2's absent provider limit", () => {
    expect(schedulerSchema.parse({version:3,revision:0,activeLimit:2,providerLimit:20,active:[],queue:[],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null})).toMatchObject({version:3});
    const old = {version:3,revision:0,activeLimit:2,providerLimit:20,active:[],queue:[],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null};
    const v2 = {revision:old.revision,activeLimit:old.activeLimit,active:old.active,queue:old.queue,resumes:old.resumes,providerSlots:old.providerSlots,providerWaiters:old.providerWaiters,providerTurn:old.providerTurn,heavy:old.heavy};
    expect(schedulerSchema.parse({...v2, version: 2})).toMatchObject({providerLimit: 11});
  });
  it("leases all 3 + 1 + 11 tasks across three parents before any completes", async () => {
    const f = await fixture();
    f.saved(0, STAGE_NAMES.slice(0, 9));
    f.saved(2, ["base"]);
    const claimed = await Promise.all(Array.from({length: 20}, (_, n) => f.service.claim(`worker-${n}`)));
    const counts = f.jobs.map(job => claimed.filter(c => c?.id === job.id).length);
    expect(counts).toEqual([3, 1, 11]);
    expect(claimed.filter(Boolean)).toHaveLength(15);
    expect(claimed.slice(0, 3).map(c => c?.id)).toEqual(f.jobs.map(j => j.id));
    expect(JSON.parse(f.store.ledger.get("scheduler")!.value).providerSlots).toHaveLength(15);
  });
  it.each([1, 20, 22])("shares the %i task limit between independent claimers", async limit => {
    const f = await fixture(limit);
    f.saved(0, ["base"]); f.saved(1, ["base"]); f.saved(2, ["base"]);
    const claims = await Promise.all(Array.from({length: 30}, (_, n) => f.service.claim(`process-${n % 3}-${n}`)));
    expect(claims.filter(Boolean)).toHaveLength(limit);
    const raw = JSON.parse(f.store.ledger.get("scheduler")!.value);
    expect(raw.providerSlots).toHaveLength(limit);
    expect(new Set(raw.tasks.filter((t: {status: string}) => t.status === "running").map((t: {lease: {leaseId: string}}) => t.lease.leaseId)).size).toBe(limit);
  });
});
