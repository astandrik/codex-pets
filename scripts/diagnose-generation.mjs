#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readYdbCliConfig} from './lib/ydb-cli.mjs';

export const HELP=`Usage:
  node scripts/diagnose-generation.mjs --job-id ID1 --job-id ID2
  node scripts/diagnose-generation.mjs --job-id ID1 --job-id ID2 --apply --expected-revision REV1 --expected-revision REV2

Default: offline diagnosis without database writes or provider calls.
Supply exactly two distinct private generation IDs and an explicit YDB target.
Run from the repository root with the pinned Python dependencies installed.
For --apply, revisions must match the two jobs in the same order.
Applying diagnostics requires separate operator approval. Images, TTL and receipts are preserved.`;

const hash=/^[a-f0-9]{64}$/;
export function parseDiagnosticArgs(argv){
 if(argv.length===1&&argv[0]==='--help')return {mode:'help'};
 const ids=[],expectedRevisions=[];let mode='dry-run',selectedMode=false;
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];
  if(flag==='--job-id'||flag==='--expected-revision'){
   const value=argv[++i];if(!hash.test(value??''))throw Error('invalid_arguments');
   (flag==='--job-id'?ids:expectedRevisions).push(value);
  }else if(flag==='--apply'||flag==='--dry-run'){
   if(selectedMode)throw Error('invalid_arguments');
   selectedMode=true;mode=flag==='--apply'?'apply':'dry-run';
  }else throw Error('invalid_arguments');
 }
 if(ids.length!==2||new Set(ids).size!==2||expectedRevisions.length!==(mode==='apply'?2:0))throw Error('invalid_arguments');
 return {mode,ids,expectedRevisions};
}

export async function runDiagnosticCli(argv=process.argv.slice(2),{load=loadProductionService,write=console.log,env=process.env}={}){
 const args=parseDiagnosticArgs(argv);
 if(args.mode==='help'){write(HELP);return 0;}
 try{readYdbCliConfig(env,{requireExplicitTarget:true});}catch{throw Error('explicit_target_required');}
 const service=await load();
 try{
  const results=[];
  for(const id of args.ids)results.push(await service.diagnose(id));
  const writes=args.mode==='apply'?await service.apply(results,args.expectedRevisions):0;
  write(JSON.stringify({operation:'diagnose-generation',mode:args.mode,writes,jobs:results.map((r,index)=>({index:index+1,sourceRevision:r.sourceRevision,status:r.status,issues:r.issues,diagnostic:r.diagnostic,changed:r.changed}))}));
  return results.some(r=>r.status==='unknown')?1:0;
 }finally{await service.dispose();}
}

async function loadProductionService(){
 const {register}=await import('node:module');
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../src');
 register(new URL('./lib/related-pets-typescript-loader.mjs',import.meta.url),{parentURL:import.meta.url,data:{sourceRootUrl:pathToFileURL(root).href}});
 const {generationStore}=await import(pathToFileURL(path.join(root,'lib/pets/generation/store.ts')).href);
 const {spriteRenderer}=await import(pathToFileURL(path.join(root,'lib/pets/generation/sprite-renderer.ts')).href);
 const {diagnoseSavedGeneration,applyGenerationDiagnostics}=await import(pathToFileURL(path.join(root,'lib/pets/generation/generation-diagnostics.ts')).href);
 const {destroyYdbDriver}=await import(pathToFileURL(path.join(root,'lib/ydb/client.ts')).href);
 return {diagnose:id=>diagnoseSavedGeneration(generationStore,spriteRenderer,id),apply:(results,revisions)=>applyGenerationDiagnostics(generationStore,results,revisions),dispose:destroyYdbDriver};
}

const entry=process.argv[1];
if(entry&&pathToFileURL(path.resolve(entry)).href===import.meta.url){
 runDiagnosticCli().then(code=>{process.exitCode=code;}).catch(error=>{
  const allowed=new Set(['invalid_arguments','invalid_argument','explicit_target_required','not_found','generation_expired','continuation_busy','base_not_ready','saved_stage_unavailable','continuation_source_conflict','diagnostics_unavailable']);
  const reason=allowed.has(error?.code)?error.code:allowed.has(error?.message)?error.message:'diagnostics_failed';
  console.error(JSON.stringify({operation:'diagnose-generation',status:'failed',reason}));process.exitCode=1;
 });
}
