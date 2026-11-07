import {expect,it} from 'vitest';
import {batchSchema,createBatch,pruneExpiredBatch} from './batch-model';
it('rejects corrupted duplicate request identities rather than silently resetting recovery',()=>{
  const batch=createBatch(),id=crypto.randomUUID(),requestId=crypto.randomUUID();
  const item={id,requestId,name:'a.png',type:'image/png',state:'ready' as const};
  batch.items=[item,{...item,id:crypto.randomUUID()}];expect(batchSchema.safeParse(batch).success).toBe(false);
});
it('preserves still-live late results after the seven-day file deadline',()=>{
  const batch=createBatch(),now=batch.expiresAt+1;
  batch.items=[{id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'late.png',type:'image/png',state:'accepted',receipt:{generationId:'a'.repeat(64),expiresAt:new Date(now+1000).toISOString()}},{id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'unsent.png',type:'image/png',state:'ready'}];
  const pruned=pruneExpiredBatch(batch,now)!;
  expect(pruned.items[0].receipt).toEqual(batch.items[0].receipt);expect(pruned.items[1].state).toBe('invalid');
  expect(pruneExpiredBatch(batch,now+1001)).toBeNull();
});
