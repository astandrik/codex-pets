import {randomUUID} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {pathToFileURL} from "node:url";
import {expect, it, vi} from "vitest";

it.skipIf(process.env.PET_CLAIM_YDB_INTEGRATION !== "1")("bounds legacy batch responses and fences independent claim processes on real YDB", async () => {
  if (process.env.YDB_PETS_ENDPOINT !== "grpc://127.0.0.1:23136" || process.env.YDB_PETS_DATABASE !== "/local") throw Error("disposable test database required");
  const {withSession, TypedValues, destroyYdbDriver} = await import("@/lib/ydb/client");
  const {generationStore: store} = await import("./store");
  const {createGenerationService} = await import("./service");
  vi.stubEnv("PET_GENERATION_PROVIDER_CALLS", "20");
  const now = Date.now(), ids = Array.from({length: 100}, (_, i) => (i + 1).toString(16).padStart(64, "0"));
  const job = (id: string) => ({id, prompt: "Synthetic", displayName: "Synthetic", worker: "", status: "queued" as const, createdAt: now, expiresAt: now + 86400000, pipelineVersion: 2 as const, executionVersion: 3 as const, reviewBase: true, promptRevision: "test", stages: []});
  const {TableDescription, Column, Types} = await import("ydb-sdk");
  const created: string[] = [];
  try {
    for (const [table, columns, keys] of [["codex_pet_generation_jobs", ["id", "payload", "expires_at"], ["id"]], ["codex_pet_generation_artifacts", ["id", "kind", "bytes", "expires_at"], ["id", "kind"]], ["codex_pet_generation_quotas", ["record_key", "payload", "expires_at"], ["record_key"]]] as const) {
      const description = new TableDescription();
      for (const column of columns) description.withColumn(new Column(column, column === "expires_at" ? Types.TIMESTAMP : column === "bytes" ? Types.BYTES : Types.UTF8));
      description.withPrimaryKeys(...keys);
      await withSession(s => s.createTable(table, description));
      created.push(table);
    }
    // Over 48 MiB in aggregate, while every legacy row is independently readable.
    for (const id of ids) {
      const payload = JSON.stringify({...job(id), legacyImageBytes: "x".repeat(600_000)});
      await withSession(s => s.executeQuery("DECLARE $id AS Utf8; DECLARE $payload AS Utf8; DECLARE $expires AS Timestamp; UPSERT INTO codex_pet_generation_jobs(id,payload,expires_at) VALUES($id,$payload,$expires);", {$id:TypedValues.utf8(id),$payload:TypedValues.utf8(payload),$expires:TypedValues.timestamp(new Date(now+86400000))}));
    }
    expect((await store.transaction(tx => tx.getJobs(ids))).size).toBe(100);
    for (const id of ids) await store.transaction(tx => tx.putJob(job(id)));
    const unknown = Array.from({length:3}, (_, i) => ({jobId:String(i+6).repeat(64),owner:"historical",leaseId:randomUUID(),key:"stage:base",startedAt:now-60000,unknown:true,dispatched:true}));
    const state = {version:3,revision:0,activeLimit:1,providerLimit:20,active:[],queue:ids,resumes:{},providerSlots:unknown,providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null};
    const budget = {spent:{},reservations:Object.fromEntries([...ids,...unknown.map(s=>s.jobId)].map(id=>[id,{remainingMicroUsd:0,unknown:!ids.includes(id)}]))};
    await store.transaction(async tx => {
      await tx.putLedger("scheduler",JSON.stringify(state),now+86400000);
      await tx.putLedger("budget",JSON.stringify(budget),now+86400000);
    });
    const sourceRoot = pathToFileURL(process.cwd()+"/src").href;
    const loader = pathToFileURL(process.cwd()+"/scripts/lib/related-pets-typescript-loader.mjs").href;
    const child = `
      import {register} from 'node:module';
      register(${JSON.stringify(loader)}, {parentURL:import.meta.url, data:{sourceRootUrl:${JSON.stringify(sourceRoot)}}});
      const {generationStore} = await import(${JSON.stringify(sourceRoot+"/lib/pets/generation/store.ts")});
      const {createGenerationService} = await import(${JSON.stringify(sourceRoot+"/lib/pets/generation/service.ts")});
      const {destroyYdbDriver} = await import(${JSON.stringify(sourceRoot+"/lib/ydb/client.ts")});
      try {
        const service = createGenerationService(generationStore, {enabled:()=>true,secret:()=> 'synthetic'});
        const results = await Promise.allSettled(Array.from({length:20},(_,i)=>service.claim(process.pid+':'+i)));
        console.log(JSON.stringify({
          claims:results.filter(r=>r.status==='fulfilled'&&r.value).map(r=>({id:r.value.id,lease:r.value.workerLeaseId})),
          errors:results.filter(r=>r.status==='rejected').map(r=>r.reason.constructor.status??null),
        }));
      } finally {await destroyYdbDriver();}
    `;
    const run = () => promisify(execFile)(process.execPath,["--input-type=module","-e",child],{timeout:120000,encoding:"utf8",env:{NODE_ENV:"test",PATH:process.env.PATH,YDB_PETS_ENDPOINT:process.env.YDB_PETS_ENDPOINT,YDB_PETS_DATABASE:"/local",YDB_ANONYMOUS_CREDENTIALS:"1",PET_GENERATION_PROVIDER_CALLS:"20"}});
    const results = await Promise.allSettled([run(),run()]);
    const reports = results.map(result => {
      if (result.status === "rejected") throw result.reason;
      return JSON.parse(result.value.stdout.trim().split("\n").at(-1)!) as {claims:{id:string;lease:string}[];errors:(number|null)[]};
    });
    // Independent processes can exhaust a known ABORTED retry; they must not invent leases.
    for (const code of reports.flatMap(report=>report.errors)) expect(code).toBe(400040);
    const claims = reports.flatMap(report=>report.claims);
    expect(claims).toHaveLength(17);expect(new Set(claims.map(c=>c.id)).size).toBe(17);expect(new Set(claims.map(c=>c.lease)).size).toBe(17);
    const after = await store.transaction(tx=>tx.getLedger("scheduler",Date.now()));
    expect(JSON.parse(after!).providerSlots.filter((s:{unknown?:boolean})=>s.unknown)).toEqual(unknown);
    const service = createGenerationService(store,{enabled:()=>true,secret:()=>"synthetic"});
    expect(await service.claim("full")).toBeNull();
    const afterBudget = await store.transaction(tx=>tx.getLedger("budget",Date.now()));
    expect(JSON.parse(afterBudget!)).toEqual(budget);
  } finally {
    for (const table of created.reverse()) await withSession(s => s.dropTable(table));
    vi.unstubAllEnvs();await destroyYdbDriver();
  }
},180000);
