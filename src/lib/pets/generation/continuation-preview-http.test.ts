import {expect,it,vi,afterEach} from 'vitest';
import {GET} from '@/app/api/pet-generations/[id]/continuation-preview/[asset]/route';
import {petGeneration} from './service';
import {continuationFixture} from './continuation-fixture.test-utils';
import {readContinuationPreview} from './continuation-preview';
import {createHash} from 'node:crypto';
afterEach(()=>vi.restoreAllMocks());
it('serves exact bytes and private headers on successful and invalid reads',async()=>{
 const f=await continuationFixture();vi.spyOn(petGeneration,'getContinuationPreview').mockImplementation((id,asset,v)=>readContinuationPreview(f.store,id,asset,v,()=>f.config.now));const v=createHash('sha256').update(f.image).digest('hex');
 for(const asset of ['idle','reference.png']){
 const response=await GET(new Request('https://pets.example/api?v='+v),{params:Promise.resolve({id:f.job.id,asset})});expect(response.status).toBe(asset==='idle'?200:404);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');expect(response.headers.get('x-content-type-options')).toBe('nosniff');if(asset==='idle'){expect(response.headers.get('content-type')).toBe('image/png');expect(Buffer.from(await response.arrayBuffer())).toEqual(f.image);}
 }
 expect(f.store.ledger.size).toBe(0);
});
