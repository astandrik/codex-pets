import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {afterEach,expect,it,vi} from 'vitest';
import {continuationFixture,failedAnimationRevisionFixture} from './continuation-fixture.test-utils';
import {buildContinuationPreviews,readContinuationPreview} from './continuation-preview';
import {inspectContinuationSource} from './continuation-source';
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
afterEach(()=>vi.unstubAllEnvs());
it('describes raw targets and verified atlas rows without substituting missing targets',async()=>{
 const f=await failedAnimationRevisionFixture();const s=await inspectContinuationSource(f.store,f.job.id,f.config.now);const p=buildContinuationPreviews(s);
 expect(p.strips.find(x=>x.state==='idle')?.preview?.kind).toBe('source-image');
 expect(p.strips.find(x=>x.state==='waving')?.preview).toBeUndefined();
 expect(p.strips.find(x=>x.state==='jumping')?.preview).toMatchObject({kind:'atlas-row',row:4,frames:5});
 expect(new Set(p.strips.filter(x=>x.preview?.kind==='atlas-row').map(x=>x.preview!.url)).size).toBe(1);
 expect(p.character?.displayName).toBe('Orb');expect(JSON.stringify(p)).not.toContain('textInputTokens');
});
it('reads exactly one raw artifact without writes, even when intake is off',async()=>{
 const f=await continuationFixture();vi.stubEnv('PET_GENERATION_CONTINUATION_ENABLED','false');const read=vi.spyOn(f.store,'readArtifact');const before=structuredClone({jobs:f.store.jobs,ledger:f.store.ledger});
 const result=await readContinuationPreview(f.store,f.job.id,'idle',hash(f.image),()=>f.config.now);
 expect(result.bytes).toEqual(f.image);expect(result.contentType).toBe('image/png');expect(read).toHaveBeenCalledTimes(1);expect({jobs:f.store.jobs,ledger:f.store.ledger}).toEqual(before);
});
it('detects the actual format of an atlas named webp',async()=>{
 const f=await failedAnimationRevisionFixture();const result=await readContinuationPreview(f.store,f.job.id,'atlas-revision',hash(f.atlas),()=>f.config.now);expect(result.contentType).toBe('image/png');expect(result.bytes).toEqual(f.atlas);
 const webp=await sharp(f.atlas).webp({lossless:true}).toBuffer();f.store.jobs.set(f.job.id,{...f.job,animationRevision:{...f.job.animationRevision!,sourceAtlasSha256:hash(webp)}});f.store.artifacts.set(f.job.id+':revision-source.webp',{bytes:webp,expiresAt:f.job.expiresAt});
 expect((await readContinuationPreview(f.store,f.job.id,'atlas-revision',hash(webp),()=>f.config.now)).contentType).toBe('image/webp');
});
it('rejects arbitrary assets, bad versions, missing files and expired jobs',async()=>{
 const f=await continuationFixture();for(const asset of ['base','reference.png','../stage-base.png'])await expect(readContinuationPreview(f.store,f.job.id,asset,hash(f.image),()=>f.config.now)).rejects.toMatchObject({code:'not_found'});
 await expect(readContinuationPreview(f.store,f.job.id,'idle','bad',()=>f.config.now)).rejects.toMatchObject({code:'not_found'});
 await expect(readContinuationPreview(f.store,f.job.id,'idle','b'.repeat(64),()=>f.config.now)).rejects.toMatchObject({code:'continuation_source_conflict'});
 f.store.artifacts.delete(f.job.id+':stage-idle.png');await expect(readContinuationPreview(f.store,f.job.id,'idle',hash(f.image),()=>f.config.now)).rejects.toMatchObject({code:'not_found'});
 f.config.now=f.job.expiresAt;await expect(readContinuationPreview(f.store,f.job.id,'idle',hash(f.image),()=>f.config.now)).rejects.toMatchObject({code:'generation_expired'});
});
it('rejects corrupt images and a source changed or expired during reading',async()=>{
 for(const kind of ['corrupt','change','expire']){
 const f=await continuationFixture();const original=f.store.readArtifact.bind(f.store);const bytes=kind==='corrupt'?Buffer.from('bad'):f.image;
 if(kind==='corrupt'){f.store.jobs.set(f.job.id,{...f.job,stages:f.job.stages.map(s=>s.name==='idle'?{...s,sha256:hash(bytes)}:s)});f.store.artifacts.set(f.job.id+':stage-idle.png',{bytes,expiresAt:f.job.expiresAt});}
 vi.spyOn(f.store,'readArtifact').mockImplementation(async(...args)=>{const b=await original(...args);if(kind==='change')f.store.jobs.set(f.job.id,{...f.job,displayName:'changed'});if(kind==='expire')f.config.now=f.job.expiresAt;return b;});
 await expect(readContinuationPreview(f.store,f.job.id,'idle',hash(bytes),()=>f.config.now)).rejects.toMatchObject({code:kind==='expire'?'generation_expired':kind==='change'?'continuation_source_conflict':'saved_stage_unavailable'});
 }
});
it('rejects byte and pixel limits before returning a raw image',async()=>{
 for(const bytes of [Buffer.alloc(8*1024*1024+1),await sharp({create:{width:5001,height:5000,channels:4,background:'red'}}).png().toBuffer()]){
 const f=await continuationFixture();f.store.jobs.set(f.job.id,{...f.job,stages:f.job.stages.map(s=>s.name==='idle'?{...s,sha256:hash(bytes)}:s)});f.store.artifacts.set(f.job.id+':stage-idle.png',{bytes,expiresAt:f.job.expiresAt});
 await expect(readContinuationPreview(f.store,f.job.id,'idle',hash(bytes),()=>f.config.now)).rejects.toMatchObject({code:'saved_stage_unavailable'});
 }
});
