import {afterEach,expect,it,vi} from "vitest";
import {configuredProviderCalls} from "./execution-limits";
import {transitionScheduler} from "./scheduler-state";
import {schedulerSchema} from "./model";

afterEach(()=>vi.unstubAllEnvs());
it("defaults the new pool to 20 without reinterpreting old v2 records",()=>{
  vi.stubEnv("PET_GENERATION_PROVIDER_CALLS",undefined);
  expect(configuredProviderCalls()).toBe(20);
  const old={version:2,revision:7,activeLimit:2,active:[],queue:[],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null};
  expect(schedulerSchema.parse(old)).toMatchObject({providerLimit:11});
});
it("explicitly migrates a drained scheduler and retains its parent admission capacity",()=>{
  const old=schedulerSchema.parse({version:2,revision:7,activeLimit:2,active:[],queue:["a".repeat(64)],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null});
  const next=transitionScheduler(old,{action:"activate-tasks",expectedRevision:7,now:0});
  expect(next).toMatchObject({version:3,providerLimit:20,activeLimit:2,queue:["a".repeat(64)],tasks:[],taskTurn:null});
});
it("blocks migration while a provider call is outstanding",()=>{
  const old=schedulerSchema.parse({version:2,revision:7,activeLimit:2,active:[],queue:[],resumes:{},providerSlots:[{jobId:"a",owner:"worker",leaseId:"b",key:"base",startedAt:0}],providerWaiters:[],providerTurn:null,heavy:null});
  expect(()=>transitionScheduler(old,{action:"activate-tasks",expectedRevision:7,now:0})).toThrow("scheduler_not_drained");
});
it("dry-run and rejected apply preserve UUIDs, jobs, budget and scheduler bytes",async()=>{
  const {taskFixture}=await import("./task-pool.test-utils");const {changeSchedulerState}=await import("./scheduler-state");
  const f=await taskFixture();const row=f.store.ledger.get("scheduler")!;
  const legacy=JSON.parse(row.value);delete legacy.tasks;delete legacy.taskTurn;legacy.version=2;row.value=JSON.stringify(legacy);
  const original=row.value,budget=f.store.ledger.get("budget")!.value,jobs=JSON.stringify([...f.store.jobs]);
  const next=await changeSchedulerState(f.store,{action:"activate-tasks",expectedRevision:0,now:f.clock.now});
  expect(next).toMatchObject({version:3,providerLimit:20});expect(f.store.ledger.get("scheduler")!.value).toBe(original);
  await expect(changeSchedulerState(f.store,{action:"activate-tasks",expectedRevision:0,now:f.clock.now,apply:true})).rejects.toThrow("scheduler_drain_required");
  expect(f.store.ledger.get("budget")!.value).toBe(budget);expect(JSON.stringify([...f.store.jobs])).toBe(jobs);
  vi.stubEnv("PET_GENERATION_DRAIN","true");
  await changeSchedulerState(f.store,{action:"activate-tasks",expectedRevision:0,now:f.clock.now,apply:true});
  expect(JSON.parse(f.store.ledger.get("scheduler-backup:0")!.value)).toEqual(JSON.parse(original));
  await expect(changeSchedulerState(f.store,{action:"limit",expectedRevision:0,providerLimit:1,now:f.clock.now,apply:true})).rejects.toThrow("scheduler_conflict");
});
it.each(["0","23","1.5","01","bad"])("rejects bad task concurrency %s without starting an operation",async value=>{
  const {taskFixture}=await import("./task-pool.test-utils");const f=await taskFixture();const before=f.store.ledger.get("scheduler")!.value;
  vi.stubEnv("PET_GENERATION_PROVIDER_CALLS",value);
  await expect(f.service.claim("worker")).rejects.toMatchObject({code:"generation_not_configured"});
  expect(f.store.ledger.get("scheduler")!.value).toBe(before);
});
it("does not reinterpret an old non-checkpointed queued job as twelve paid stages",async()=>{
  const {taskFixture}=await import("./task-pool.test-utils");const {changeSchedulerState}=await import("./scheduler-state");
  const f=await taskFixture();f.store.jobs.get(f.jobs[0].id)!.pipelineVersion=1;
  await expect(f.service.claim("worker")).rejects.toMatchObject({code:"generation_not_configured"});
  const row=f.store.ledger.get("scheduler")!;const legacy=JSON.parse(row.value);delete legacy.tasks;delete legacy.taskTurn;legacy.version=2;row.value=JSON.stringify(legacy);
  const original=row.value;
  await expect(changeSchedulerState(f.store,{action:"activate-tasks",expectedRevision:0,now:f.clock.now})).rejects.toThrow("scheduler_legacy_job_not_drained");
  expect(f.store.ledger.get("scheduler")!.value).toBe(original);
});
