import {readFileSync} from "node:fs";
import vm from "node:vm";
import {randomUUID} from "node:crypto";
import ts from "typescript";
import {it,expect,vi} from "vitest";
import {createGenerationService} from "./service";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {STAGE_NAMES} from "./model";
import {MemoryStore} from "./test-store";

type Execute=(sql:string)=>Promise<unknown>;
type Wrapper=<T>(operation:(execute:Execute)=>Promise<T>)=>Promise<T>;
function conflictingCheckpoints(){
 let revision=0,nextId=0,conflicts=0;
 class YdbError extends Error{}
 class Conflict extends YdbError{static status=400040;}
 const client={StatusCode:{ABORTED:400040},YdbError,withSessionOnce:async(operation:(session:unknown)=>Promise<unknown>)=>{
  const id=++nextId;let snapshot=0;
  return operation({beginTransaction:async()=>{snapshot=revision;return{id:String(id)};},executeQuery:async(_sql:string,_params:unknown,control:{commitTx?:boolean})=>{
   if(control.commitTx){if(snapshot!==revision){conflicts++;throw new Conflict('ABORTED');}revision++;}return{};
  },rollbackTransaction:async()=>undefined});
 }};
 let timers:(()=>void)[]=[],scheduled=false;
 const coordinatedTimer=(callback:()=>void)=>{timers.push(callback);if(!scheduled){scheduled=true;setImmediate(()=>{const cohort=timers;timers=[];scheduled=false;cohort.forEach(fn=>fn());});}};
 const source=readFileSync(new URL('../../ydb/transaction.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS}}).outputText;
 const exported:{withSerializableTransaction?:Wrapper}={};
 vm.runInNewContext(compiled,{exports:exported,require:(name:string)=>{if(name!=='@/lib/ydb/client')throw Error('unexpected import');return client;},setTimeout:coordinatedTimer,Reflect});
 if(!exported.withSerializableTransaction)throw Error('missing transaction wrapper');
 return{transaction:exported.withSerializableTransaction,get conflicts(){return conflicts;}};
}
it('negative control: eleven concurrent checkpoints can exhaust five real transaction attempts',async()=>{
 const db=conflictingCheckpoints();const rows=await Promise.allSettled(Array.from({length:11},()=>db.transaction(execute=>execute('WRITE shared checkpoint'))));
 expect(rows.filter(r=>r.status==='fulfilled')).toHaveLength(5);expect(rows.filter(r=>r.status==='rejected')).toHaveLength(6);expect(db.conflicts).toBe(40);
});
it('keeps eleven image calls parallel while serializing conflicting checkpoint saves without repayment',async()=>{
 const store=new MemoryStore(),service=createGenerationService(store,{enabled:()=>true,secret:()=> 'checkpoint-contention-secret-at-least32'});
 await service.generate({prompt:'Synthetic concurrency proof',requestId:randomUUID()},'203.0.113.82');
 const native=conflictingCheckpoints(),save=service.saveStage;
 vi.spyOn(service,'saveStage').mockImplementation(async(...args)=>{await native.transaction(execute=>execute('WRITE shared checkpoint'));return save(...args);});
 let active=0,maxActive=0;const calls:string[]=[],groups=new Map<number,{count:number;promise:Promise<void>;resolve:()=>void}>();
 const worker=createSpriteGenerationWorker({service,store,renderer:{open:async()=>({prepare:async()=>undefined,generate:async name=>{
  calls.push(name);active++;maxActive=Math.max(maxActive,active);
  if(name!=='base'){
   const number=Math.floor((STAGE_NAMES.indexOf(name)-1)/11);let group=groups.get(number);
   if(!group){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});group={count:0,promise,resolve};groups.set(number,group);}
   group.count++;if(group.count===Math.min(11,11-number*11))group.resolve();await group.promise;
  }
  active--;return{bytes:Buffer.from(name),generationMs:1,usage:{textInputTokens:1,imageInputTokens:0,outputTokens:1,costUsd:.04}};
 },compose:async()=>Buffer.from('atlas'),cleanup:async()=>undefined})},build:async()=>({'pet.zip':Buffer.from('zip')})});
 expect(await worker('owner')).toBe('completed');expect(maxActive).toBe(11);expect(calls).toHaveLength(12);expect(new Set(calls).size).toBe(12);expect(native.conflicts).toBe(0);
 const scheduler=JSON.parse(store.ledger.get('scheduler')!.value);expect(scheduler.pauseReason).toBeUndefined();expect(scheduler.active).toBeNull();
 const job=[...store.jobs.values()][0];expect(job.stages.filter(s=>s.status==='completed')).toHaveLength(12);expect(JSON.parse(store.ledger.get('budget')!.value).reservations).toEqual({});
});
