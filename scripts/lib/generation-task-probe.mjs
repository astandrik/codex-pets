// Test-only process. Never connect to a production endpoint or invoke a provider.
import {register} from "node:module";
import {pathToFileURL} from "node:url";
import path from "node:path";
const endpoint=new URL(process.env.YDB_PETS_ENDPOINT??"invalid:");
if(!["localhost","127.0.0.1","[::1]"].includes(endpoint.hostname)||!/^\/local\/codex_parallelism_test_[a-z0-9]+$/.test(process.env.YDB_PETS_DATABASE??""))throw Error("Disposable local database required");
const root=path.resolve("src");
register(new URL("./related-pets-typescript-loader.mjs",import.meta.url),{parentURL:import.meta.url,data:{sourceRootUrl:pathToFileURL(root).href}});
const load=name=>import(pathToFileURL(path.join(root,`lib/pets/generation/${name}.ts`)).href);
const {generationStore}=await load("store");const {createGenerationService}=await load("service");
const {destroyYdbDriver}=await import(pathToFileURL(path.join(root,"lib/ydb/client.ts")).href);
const service=createGenerationService(generationStore,{enabled:()=>true,secret:()=>"isolated-local-task-test-secret"});
const [owner,run]=process.argv.slice(2);const jobs=[];const deadline=Date.now()+30000;
try{
  while(Date.now()<deadline){
    let job;
    try{job=await service.claim(owner);}catch{await new Promise(r=>setTimeout(r,50));continue;}
    if(!job)break;
    if(job.workerTask?.kind!=="image")throw Error("Unexpected non-image task");
    await service.beginStage(job,job.workerTask.stage);
    await service.authorizeStage(job,job.workerTask.stage);
    jobs.push(job);
  }
  await generationStore.transaction(tx=>tx.putLedger(`test:held:${run}:${owner}`,String(jobs.length),Date.now()+60000));
  while(Date.now()<deadline&&!await generationStore.transaction(tx=>tx.getLedger(`test:release:${run}`,Date.now())))await new Promise(r=>setTimeout(r,50));
  if(Date.now()>=deadline)throw Error("Release barrier timeout");
  await Promise.all(jobs.map(async job=>{
    await service.saveStage(job,job.workerTask.stage,Buffer.from(job.workerTask.stage),{generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.001}});
    await service.completeTask(job);
  }));
  console.log("PROBE:"+JSON.stringify({count:jobs.length}));
}finally{await destroyYdbDriver();}
