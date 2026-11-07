import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {IDBFactory,IDBObjectStore} from 'fake-indexeddb';
import {openBatchStore,type BatchStore} from './batch-store';
import {batchSnapshot,type BatchItem} from './batch-model';
import {runBatch} from './batch-runner';

let factory:IDBFactory;
let connections:IDBDatabase[];
beforeEach(()=>{
  factory=new IDBFactory();connections=[];
  vi.stubGlobal('indexedDB',factory);
  const open=factory.open.bind(factory);
  vi.spyOn(factory,'open').mockImplementation((...args)=>{
    const request=open(...args);
    request.addEventListener('success',()=>connections.push(request.result));
    return request;
  });
});
afterEach(()=>{
  for(const connection of connections)connection.close();
  vi.restoreAllMocks();vi.unstubAllGlobals();
});

async function fixture(count=2) {
  const store=await openBatchStore();
  for(let i=0;i<count;i++) {
    const item:BatchItem={id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:`image-${i}.png`,type:'image/png',state:'ready'};
    await store.add(item,new Blob([`original-${i}`],{type:'image/png'}),new Blob([`preview-${i}`],{type:'image/webp'}),batchSnapshot(await store.read()));
  }
  const batch=(await store.read())!;
  return {store,batch};
}

// Read every persisted key/value, including orphaned files that a metadata-only read would miss.
async function contents() {
  const request=factory.open('pets-image-batches',1);
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  });
  const names=['batch','files','previews'];
  const tx=db.transaction(names,'readonly');
  const reads=names.map(name=>({name,keys:tx.objectStore(name).getAllKeys(),values:tx.objectStore(name).getAll()}));
  await new Promise<void>((resolve,reject)=>{
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error);tx.onerror=()=>reject(tx.error);
  });
  return Promise.all(reads.map(async({name,keys,values})=>({name,keys:keys.result,values:await Promise.all((values.result as unknown[]).map(async value=>value instanceof Blob?{type:value.type,bytes:await value.text()}:value))})));
}

function abortAfterFileDelete(id:string) {
  const remove=IDBObjectStore.prototype.delete;
  return vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,key){
    const request=remove.call(this,key);
    if(this.name==='files'&&key===id)request.addEventListener('success',()=>this.transaction.abort(),{once:true});
    return request;
  });
}

async function accept(store:BatchStore,id:string,itemId:string) {
  await store.update(id,batch=>{
    Object.assign(batch.items.find(item=>item.id===itemId)!,{
      state:'accepted',receipt:{generationId:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()},
      historyPending:true,historySavedAt:Date.now(),
    });
    return batch;
  },{removeFiles:[itemId]});
}

describe('batch IndexedDB transactions',()=>{
  it('rolls back receipt, history outbox and input deletion together on abort',async()=>{
    const {store,batch}=await fixture();
    const before=await contents();
    const remove=abortAfterFileDelete(batch.items[0].id);
    await expect(accept(store,batch.id,batch.items[0].id)).rejects.toBeTruthy();
    expect(remove).toHaveBeenCalled();
    expect(await contents()).toEqual(before);
    remove.mockRestore();
    await accept(store,batch.id,batch.items[0].id);
    const saved=(await store.read())!;
    expect(saved.items[0]).toMatchObject({requestId:batch.items[0].requestId,state:'accepted',historyPending:true,receipt:{generationId:'a'.repeat(64)}});
    expect(saved.expiresAt).toBe(batch.expiresAt);
    expect(await store.readFile(batch.items[0].id)).toBeNull();
    expect(await (await store.readPreview(batch.items[0].id))!.text()).toBe('preview-0');
    expect(await (await store.readFile(batch.items[1].id))!.text()).toBe('original-1');
  });

  it('leaves all stores unchanged when another connection invalidates a deletion snapshot',async()=>{
    const {store,batch}=await fixture();
    const expected=batchSnapshot(batch),other=await openBatchStore();
    await other.clear(expected);
    const replacement=await fixture(100);
    const before=await contents();
    await expect(store.clear(expected)).rejects.toThrow('Пакет изменился');
    expect(await contents()).toEqual(before);
    expect((await replacement.store.read())!.items).toHaveLength(100);
  });

  it.each(['add','start'] as const)('leaves all stores unchanged on a stale %s snapshot',async action=>{
    const {store,batch}=await fixture();
    const expected=batchSnapshot(batch),other=await openBatchStore();
    const item:BatchItem={...batch.items[0],id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:'different.png'};
    // Same number of rows, but a different image and UUID in the other tab.
    await other.update(batch.id,current=>({...current,items:current.items.slice(1)}),{removeFiles:[batch.items[0].id],removePreviews:[batch.items[0].id]});
    await other.add(item,new Blob(['replacement']),new Blob(['replacement-preview']),batchSnapshot(await other.read()));
    const before=await contents(),request=vi.fn();
    if(action==='add'){
      await expect(store.add({...item,id:crypto.randomUUID(),requestId:crypto.randomUUID()},new Blob(['stale']),new Blob(['stale-preview']),expected)).rejects.toThrow('Пакет изменился');
    }else{
      await expect(runBatch(store,{expected,signal:new AbortController().signal,request,remember:()=>true})).rejects.toThrow('Пакет изменился');
      expect(request).not.toHaveBeenCalled();
    }
    expect(await contents()).toEqual(before);
  });

  it('reopens an aborted receipt and replays the same UUID and bytes without a second admission',async()=>{
    const {store,batch}=await fixture(1),item=batch.items[0];
    const admitted=new Map<string,string>(),bodies:string[]=[];
    const request=vi.fn(async(_url:string,init?:RequestInit)=>{
      const form=init!.body as FormData,uuid=String(form.get('requestId'));
      bodies.push(await (form.get('referenceImage') as Blob).text());
      if(!admitted.has(uuid))admitted.set(uuid,'b'.repeat(64));
      return Response.json({generation:{generationId:admitted.get(uuid),expiresAt:new Date(batch.createdAt+86400000).toISOString(),status:'queued'}});
    });
    const remove=abortAfterFileDelete(item.id);
    await runBatch(store,{expected:batchSnapshot(batch),signal:new AbortController().signal,request,remember:()=>true});
    remove.mockRestore();
    const reopened=await openBatchStore(),pending=(await reopened.read())!;
    expect(pending.items[0]).toMatchObject({state:'uncertain',requestId:item.requestId});
    expect(pending.items[0].receipt).toBeUndefined();
    expect(await (await reopened.readFile(item.id))!.text()).toBe('original-0');
    await runBatch(reopened,{expected:batchSnapshot(pending),signal:new AbortController().signal,request,remember:()=>true});
    expect(request).toHaveBeenCalledTimes(2);expect(admitted.size).toBe(1);expect([...admitted.keys()]).toEqual([item.requestId]);
    expect(bodies).toEqual(['original-0','original-0']);
    const saved=(await reopened.read())!;
    expect(saved.items[0].receipt?.generationId).toBe('b'.repeat(64));
    expect(saved.items[0].historyPending).toBe(false);expect(saved.expiresAt).toBe(batch.expiresAt);
    expect(await reopened.readFile(item.id)).toBeNull();
  });
});
