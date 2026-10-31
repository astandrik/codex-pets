import {z} from 'zod';
import {assemblyIssuesSchema,type AssemblyIssue,continuationLockKey} from '@/lib/pets/generation/continuation-model';
import {inspectContinuationSource,jobRevision,requireContinuationSource,sha} from '@/lib/pets/generation/continuation-source';
import {readFailureDiagnostic,type FailureDiagnostic} from '@/lib/pets/generation/failure-diagnostic';
import {GENERATION_ID,GenerationError,type GenerationJob,type StageName} from '@/lib/pets/generation/model';
import type {GenerationStore,GenerationTransaction} from '@/lib/pets/generation/store';
import type {SpriteRenderer} from '@/lib/pets/generation/sprite-worker';
import {validateGeneratedSheet} from '@/lib/pets/generation/package';

const SHEET_VALIDATION_ERRORS=new Set(['image_size_limit','invalid_grid_dimensions','missing_transparency','invalid_generated_image','missing_animation_frame','clipped_animation_frame']);

export type PreparedGenerationDiagnostic={
 sourceId:string;
 sourceRevision:string;
 jobRevision:string;
 artifacts:Array<{kind:string;sha256:string}>;
 status:'valid'|'invalid'|'unknown';
 issues:AssemblyIssue[];
 diagnostic?:FailureDiagnostic;
 changed:boolean;
};

function sameDiagnostics(job:GenerationJob,result:Pick<PreparedGenerationDiagnostic,'issues'|'diagnostic'>){
 return JSON.stringify(assemblyIssuesSchema.parse(job.assemblyIssues??[]))===JSON.stringify(result.issues)
  && JSON.stringify(readFailureDiagnostic(job.failureDiagnostic))===JSON.stringify(result.diagnostic);
}

export async function diagnoseSavedGeneration(store:GenerationStore,renderer:Pick<SpriteRenderer,'open'>,id:string,now:()=>number=Date.now):Promise<PreparedGenerationDiagnostic>{
 if(!GENERATION_ID.test(id))throw new GenerationError('invalid_argument');
 const snapshot=await inspectContinuationSource(store,id,now());
 if(snapshot.targets.some(state=>!snapshot.raws.has(state)))throw new GenerationError('saved_stage_unavailable');
 const saved=new Map<StageName,Buffer>([['base',snapshot.base]]);
 for(const [state,bytes] of snapshot.raws)saved.set(state,bytes);
 const artifacts=[{kind:'stage-base.png',sha256:sha(snapshot.base)},...[...snapshot.raws].map(([state,bytes])=>({kind:`stage-${state}.png`,sha256:sha(bytes)}))];
 if(snapshot.atlas&&snapshot.atlasKind)artifacts.push({kind:snapshot.atlasKind,sha256:sha(snapshot.atlas)});
 let status:PreparedGenerationDiagnostic['status']='valid',issues:AssemblyIssue[]=[],diagnostic:FailureDiagnostic|undefined;
 if(snapshot.targets.length){
  const session=await renderer.open(snapshot.job,saved,undefined,snapshot.atlas,{diagnosticOnly:true});
  try{await validateGeneratedSheet(await session.compose());}
  catch(error){
   if(!(error instanceof GenerationError))throw error;
   if(error.code==='invalid_sprite_extraction'){
    issues=assemblyIssuesSchema.parse(error.assemblyIssues??[]);
    diagnostic=readFailureDiagnostic(error.diagnostic);
    status=issues.length?'invalid':'unknown';
    if(issues.length&&!diagnostic)diagnostic={boundary:'renderer_process',reason:'invalid_image'};
   }else if(SHEET_VALIDATION_ERRORS.has(error.code)){
    status='unknown';
    diagnostic={boundary:'artifact',reason:'invalid_image'};
   }else throw error;
  }finally{await session.cleanup();}
 }
 const current=requireContinuationSource(await store.readJob(id),now());
 if(jobRevision(current)!==snapshot.jobRevision)throw new GenerationError('continuation_source_conflict');
 const result={sourceId:id,sourceRevision:snapshot.options.sourceRevision,jobRevision:snapshot.jobRevision,artifacts,status,issues,diagnostic,changed:false};
 result.changed=status==='invalid'&&!sameDiagnostics(current,result);
 return result;
}

const lockSchema=z.object({state:z.enum(['preparing','accepted','rejected']),targetId:z.string().regex(GENERATION_ID)});
async function assertNoActiveContinuation(tx:GenerationTransaction,id:string,now:number){
 const raw=await tx.getLedger(continuationLockKey(id),now);
 if(!raw)return;
 let parsed;
 try{parsed=lockSchema.safeParse(JSON.parse(raw));}catch{throw new GenerationError('continuation_busy');}
 if(!parsed.success||parsed.data.state==='preparing')throw new GenerationError('continuation_busy');
 if(parsed.data.state==='accepted'){
  const child=await tx.getJob(parsed.data.targetId);
  if(child&&child.expiresAt>now&&['queued','generating','processing','awaiting_confirmation'].includes(child.status))throw new GenerationError('continuation_busy');
 }
}

export async function applyGenerationDiagnostics(store:GenerationStore,results:PreparedGenerationDiagnostic[],expectedRevisions:string[],now:()=>number=Date.now):Promise<number>{
 if(!results.length||results.length>2||new Set(results.map(r=>r.sourceId)).size!==results.length||expectedRevisions.length!==results.length)throw new GenerationError('invalid_argument');
 for(const [index,result] of results.entries()){
  if(result.sourceRevision!==expectedRevisions[index])throw new GenerationError('continuation_source_conflict');
  if(result.status==='unknown'||(result.status==='invalid'&&(!result.issues.length||!readFailureDiagnostic(result.diagnostic))))throw new GenerationError('diagnostics_unavailable');
 }
 return store.transaction(async tx=>{
  const updates:GenerationJob[]=[];
  for(const result of results){
   const job=requireContinuationSource(await tx.getJob(result.sourceId),now());
   if(jobRevision(job)!==result.jobRevision)throw new GenerationError('continuation_source_conflict');
   if(job.leaseUntil&&job.leaseUntil>now())throw new GenerationError('continuation_busy');
   await assertNoActiveContinuation(tx,job.id,now());
   for(const artifact of result.artifacts){
    const bytes=await tx.getArtifact(job.id,artifact.kind,now());
    if(!bytes||sha(bytes)!==artifact.sha256)throw new GenerationError('continuation_source_conflict');
   }
   if(job.expiresAt<=now())throw new GenerationError('generation_expired');
   if(result.status==='invalid'&&!sameDiagnostics(job,result))updates.push({...job,assemblyIssues:assemblyIssuesSchema.parse(result.issues),failureDiagnostic:readFailureDiagnostic(result.diagnostic)});
  }
  for(const job of updates)if(job.expiresAt<=now())throw new GenerationError('generation_expired');
  for(const job of updates)await tx.putJob(job);
  return updates.length;
 });
}
