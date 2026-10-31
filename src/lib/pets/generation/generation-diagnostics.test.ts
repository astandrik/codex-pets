import {afterEach,expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {GenerationError} from './model';
import {continuationFixture,failedAnimationRevisionFixture} from './continuation-fixture.test-utils';
import {diagnoseSavedGeneration,applyGenerationDiagnostics} from './generation-diagnostics';
import type {SpriteRenderer} from './sprite-worker';
import type {MemoryStore} from './test-store';

afterEach(()=>vi.unstubAllEnvs());
const issue={state:'failed' as const,kind:'invalid' as const,frame:1,actual:389,expected:9003};
const failure={boundary:'renderer_process' as const,reason:'invalid_image' as const};
function snapshot(store:MemoryStore){return {jobs:structuredClone(store.jobs),ledger:structuredClone(store.ledger),artifacts:new Map([...store.artifacts].map(([key,value])=>[key,{...value,bytes:Buffer.from(value.bytes)}]))};}
function renderer(){
 const generate=vi.fn(),cleanup=vi.fn();
 const open=vi.fn<SpriteRenderer['open']>(async()=>({generate,cleanup,prepare:vi.fn(),compose:vi.fn(async()=>{throw new GenerationError('invalid_sprite_extraction',undefined,undefined,undefined,failure,undefined,undefined,[issue]);})}));
 return {renderer:{open} as Pick<SpriteRenderer,'open'>,open,generate,cleanup};
}
it('dry-run composes saved material without generation or database writes',async()=>{
 const f=await continuationFixture();const fake=renderer();const before=snapshot(f.store);
 const result=await diagnoseSavedGeneration(f.store,fake.renderer,f.job.id,()=>f.config.now);
 expect(result).toMatchObject({status:'invalid',issues:[issue],diagnostic:failure,changed:true});
 expect(fake.open.mock.calls[0]?.[4]).toEqual({diagnosticOnly:true});
 expect(fake.generate).not.toHaveBeenCalled();expect(fake.cleanup).toHaveBeenCalledOnce();
 expect({jobs:f.store.jobs,ledger:f.store.ledger,artifacts:f.store.artifacts}).toEqual(before);
});
it('does not re-extract rows when a complete verified atlas is already available',async()=>{
 const f=await failedAnimationRevisionFixture();f.store.artifacts.set(f.job.id+':source.png',{bytes:f.atlas,expiresAt:f.job.expiresAt});
 const fake=renderer();const result=await diagnoseSavedGeneration(f.store,fake.renderer,f.job.id,()=>f.config.now);
 expect(result.status).toBe('valid');expect(result.changed).toBe(false);expect(fake.open).not.toHaveBeenCalled();
 expect(await applyGenerationDiagnostics(f.store,[result],[result.sourceRevision],()=>f.config.now)).toBe(0);
});
it.each(['empty-frame','wrong-dimensions','unreadable'] as const)('does not report a composed %s atlas as valid or permit applying it',async damage=>{
 const f=await continuationFixture();const fake=renderer();const before=snapshot(f.store);
 const atlas=damage==='unreadable'?Buffer.from('invalid image'):await sharp({create:{width:damage==='wrong-dimensions'?32:1536,height:damage==='wrong-dimensions'?32:2288,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
 fake.open.mockResolvedValue({generate:fake.generate,prepare:vi.fn(),cleanup:fake.cleanup,compose:vi.fn(async()=>atlas)});
 const result=await diagnoseSavedGeneration(f.store,fake.renderer,f.job.id,()=>f.config.now);
 expect(result).toMatchObject({status:'unknown',issues:[],diagnostic:{boundary:'artifact',reason:'invalid_image'},changed:false});
 await expect(applyGenerationDiagnostics(f.store,[result],[result.sourceRevision],()=>f.config.now)).rejects.toMatchObject({code:'diagnostics_unavailable'});
 expect(fake.generate).not.toHaveBeenCalled();expect(fake.cleanup).toHaveBeenCalledOnce();
 expect({jobs:f.store.jobs,ledger:f.store.ledger,artifacts:f.store.artifacts}).toEqual(before);
});
it('reports a freshly composed atlas as valid only after application validation',async()=>{
 const {atlas}=await failedAnimationRevisionFixture();const f=await continuationFixture();const fake=renderer();const before=snapshot(f.store);
 fake.open.mockResolvedValue({generate:fake.generate,prepare:vi.fn(),cleanup:fake.cleanup,compose:vi.fn(async()=>atlas)});
 const result=await diagnoseSavedGeneration(f.store,fake.renderer,f.job.id,()=>f.config.now);
 expect(result).toMatchObject({status:'valid',issues:[],changed:false});
 expect(fake.open).toHaveBeenCalledOnce();expect(fake.cleanup).toHaveBeenCalledOnce();expect(fake.generate).not.toHaveBeenCalled();
 expect({jobs:f.store.jobs,ledger:f.store.ledger,artifacts:f.store.artifacts}).toEqual(before);
});
it('keeps an accepted UUID recoverable after diagnostic repair and feature disable',async()=>{
 vi.stubEnv('PET_GENERATION_CONTINUATION_ENABLED','true');
 const f=await continuationFixture();const input=await f.input('regenerate',['idle']);
 const accepted=await f.service.continueGeneration(f.job.id,input,'127.0.0.1');const child=f.store.jobs.get(accepted.generation!.generationId)!;
 f.store.jobs.set(child.id,{...child,status:'failed'});
 const result=await diagnoseSavedGeneration(f.store,renderer().renderer,f.job.id,()=>f.config.now);
 const receipts=structuredClone(f.store.ledger);
 expect(await applyGenerationDiagnostics(f.store,[result],[result.sourceRevision],()=>f.config.now)).toBe(1);
 vi.stubEnv('PET_GENERATION_CONTINUATION_ENABLED','false');
 expect((await f.service.findContinuation(f.job.id,input.requestId)).operation.id).toBe(input.requestId);
 expect((await f.service.continueGeneration(f.job.id,input,'127.0.0.1')).generation?.generationId).toBe(child.id);
 expect(f.store.jobs.size).toBe(2);expect(f.store.ledger).toEqual(receipts);
});
it('writes only diagnostics, keeps TTL/receipts/assets, and makes identical diagnostics a no-op',async()=>{
 vi.stubEnv('PET_GENERATION_CONTINUATION_ENABLED','true');
 const f=await continuationFixture();const fake=renderer();
 const old=structuredClone(f.job);const ledger=structuredClone(f.store.ledger);const assets=snapshot(f.store).artifacts;
 const result=await diagnoseSavedGeneration(f.store,fake.renderer,f.job.id,()=>f.config.now);
 expect(await applyGenerationDiagnostics(f.store,[result],[result.sourceRevision],()=>f.config.now)).toBe(1);
 expect(f.store.jobs.get(f.job.id)).toEqual({...old,assemblyIssues:[issue],failureDiagnostic:failure});
 expect(f.store.ledger).toEqual(ledger);expect(f.store.artifacts).toEqual(assets);
 const options=await f.service.getContinuationOptions(f.job.id);
 expect(options.requiredStates).toEqual(['failed']);expect(options.strips.filter(s=>s.status==='invalid').map(s=>s.state)).toEqual(['failed']);
 const updated=await diagnoseSavedGeneration(f.store,fake.renderer,f.job.id,()=>f.config.now);
 const transaction=f.store.transaction.bind(f.store),write=vi.fn();
 vi.spyOn(f.store,'transaction').mockImplementation(operation=>transaction(tx=>operation({...tx,putJob:async job=>{write(job);await tx.putJob(job);}})));
 expect(await applyGenerationDiagnostics(f.store,[updated],[updated.sourceRevision],()=>f.config.now)).toBe(0);
 expect(write).not.toHaveBeenCalled();
});
it.each(['job','artifact','expiry','preparing','active'] as const)('rejects %s drift without changing either job',async drift=>{
 const f=await continuationFixture();const other={...f.job,id:'b'.repeat(64)};f.store.jobs.set(other.id,other);
 for(const [key,value] of [...f.store.artifacts])if(key.startsWith(f.job.id+':'))f.store.artifacts.set(key.replace(f.job.id,other.id),value);
 const fake=renderer();const results=await Promise.all([f.job.id,other.id].map(id=>diagnoseSavedGeneration(f.store,fake.renderer,id,()=>f.config.now)));
 if(drift==='job')f.store.jobs.set(other.id,{...other,displayName:'changed'});
 if(drift==='artifact')f.store.artifacts.set(other.id+':stage-failed.png',{bytes:Buffer.from('changed'),expiresAt:other.expiresAt});
 if(drift==='expiry')f.config.now=other.expiresAt;
 if(drift==='preparing')f.store.ledger.set('continuation-lock:'+other.id,{value:JSON.stringify({state:'preparing',targetId:'c'.repeat(64),until:0}),expiresAt:other.expiresAt});
 if(drift==='active'){
  const child={...other,id:'c'.repeat(64),status:'queued' as const};f.store.jobs.set(child.id,child);
  f.store.ledger.set('continuation-lock:'+other.id,{value:JSON.stringify({state:'accepted',targetId:child.id,until:0}),expiresAt:other.expiresAt});
 }
 const before=snapshot(f.store);
 await expect(applyGenerationDiagnostics(f.store,results,results.map(r=>r.sourceRevision),()=>f.config.now)).rejects.toBeInstanceOf(GenerationError);
 expect({jobs:f.store.jobs,ledger:f.store.ledger,artifacts:f.store.artifacts}).toEqual(before);
});
it('rejects stale dry-run tokens and unknown diagnostics without writing',async()=>{
 const f=await continuationFixture();const fake=renderer();const result=await diagnoseSavedGeneration(f.store,fake.renderer,f.job.id,()=>f.config.now);
 await expect(applyGenerationDiagnostics(f.store,[result],['0'.repeat(64)],()=>f.config.now)).rejects.toMatchObject({code:'continuation_source_conflict'});
 await expect(applyGenerationDiagnostics(f.store,[{...result,status:'unknown',issues:[]}],[result.sourceRevision],()=>f.config.now)).rejects.toMatchObject({code:'diagnostics_unavailable'});
 expect(f.store.jobs.get(f.job.id)?.assemblyIssues).toBeUndefined();
});
