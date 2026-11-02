import {randomUUID,createHash} from "node:crypto";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {expect,it} from "vitest";
import {STAGE_NAMES} from "./model";
const enabled=process.env.PET_GENERATION_TASK_POOL_YDB==="1";
it.skipIf(!enabled)("shares task leases and atomic results across three real YDB worker processes",async()=>{
  const endpoint=new URL(process.env.YDB_PETS_ENDPOINT??"invalid:");
  if(!["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname)||!/^\/local\/codex_parallelism_test_[a-z0-9]+$/.test(process.env.YDB_PETS_DATABASE??""))throw Error("Disposable local database required");
  const {generationStore:store}=await import("./store");const {createGenerationService}=await import("./service");
  const {destroyYdbDriver}=await import("@/lib/ydb/client");
  const service=createGenerationService(store,{enabled:()=>true,secret:()=>"isolated-local-task-test-secret"});
  try{
    for(const scenario of [{limit:20,count:15},{limit:22,count:22}]){
      const run=randomUUID();const ids:string[]=[];
      await store.transaction(async tx=>{
        await tx.putLedger("scheduler",JSON.stringify({revision:0,queue:[],active:null}),Date.UTC(2099,0,1));
        await tx.putLedger("budget",JSON.stringify({spent:{},reservations:{}}),Date.UTC(2099,0,1));
      });
      for(let i=0;i<3;i++)ids.push((await service.generate({prompt:"Synthetic fixture",requestId:randomUUID()},`203.0.113.${scenario.limit+i}`)).generationId);
      await store.transaction(async tx=>{
        for(let i=0;i<3;i++){
          const job=(await tx.getJob(ids[i]))!;
          const names=scenario.count===15?(i===0?STAGE_NAMES.slice(0,9):i===2?["base" as const]:[]):["base" as const];
          const bytes=Buffer.from("saved"),sha256=createHash("sha256").update(bytes).digest("hex");
          job.status=names.length?"generating":"queued";
          job.stages=names.map(name=>({name,status:"completed",startedAt:Date.now(),sha256,generationMs:1}));
          for(const name of names)await tx.putArtifact(job.id,`stage-${name}.png`,bytes,job.expiresAt);
          await tx.putJob(job);
        }
        await tx.putLedger("scheduler",JSON.stringify({version:3,revision:0,activeLimit:2,providerLimit:scenario.limit,active:[],queue:ids,resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null}),Date.UTC(2099,0,1));
      });
      const children=["a","b","c"].map(owner=>promisify(execFile)(process.execPath,["scripts/lib/generation-task-probe.mjs",owner,run],{encoding:"utf8",timeout:45000,
        env:{NODE_ENV:"test",PATH:process.env.PATH,YDB_PETS_ENDPOINT:process.env.YDB_PETS_ENDPOINT,YDB_PETS_DATABASE:process.env.YDB_PETS_DATABASE,YDB_ANONYMOUS_CREDENTIALS:"1",PET_GENERATION_PROVIDER_CALLS:String(scenario.limit)}}));
      // Attach handlers immediately; failures must never become unhandled rejections.
      const completion=Promise.all(children);
      completion.catch(()=>{});
      try{
        const deadline=Date.now()+25000;
        let ready=false;
        while(Date.now()<deadline){
          ready=await store.transaction(async tx=>{for(const owner of ["a","b","c"])if(await tx.getLedger(`test:held:${run}:${owner}`,Date.now())===null)return false;return true;});
          if(ready)break;await new Promise(r=>setTimeout(r,50));
        }
        expect(ready).toBe(true);
        const state=JSON.parse((await store.transaction(tx=>tx.getLedger("scheduler",Date.now())))!);
        expect(state.providerSlots).toHaveLength(scenario.count);
        expect(state.tasks.filter((t:{status:string})=>t.status==="running")).toHaveLength(scenario.count);
        if(scenario.count===15)expect(ids.map(id=>state.providerSlots.filter((s:{jobId:string})=>s.jobId===id).length)).toEqual([3,1,11]);
      }finally{await store.transaction(tx=>tx.putLedger(`test:release:${run}`,"1",Date.now()+60000));await completion;}
      const results=await completion;
      expect(results.reduce((sum,r)=>sum+JSON.parse(r.stdout.split("\n").find(line=>line.startsWith("PROBE:"))!.slice(6)).count,0)).toBe(scenario.count);
      const state=JSON.parse((await store.transaction(tx=>tx.getLedger("scheduler",Date.now())))!);
      expect(state.providerSlots).toEqual([]);
      const budget=JSON.parse((await store.transaction(tx=>tx.getLedger("budget",Date.now())))!);
      expect(Object.values(budget.spent).reduce((sum:number,n)=>sum+Number(n),0)).toBe(scenario.count*1000);
      const all=await Promise.all(ids.map(id=>store.readJob(id)));
      expect(all.reduce((sum,j)=>sum+j!.stages.filter(s=>s.status==="completed").length,0)).toBe(scenario.count+(scenario.count===15?10:3));
    }
  }finally{await destroyYdbDriver();}
},60000);
