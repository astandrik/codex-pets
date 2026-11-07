import {describe, expect, it, vi} from 'vitest';
import {runBatch} from './batch-runner';
import {createBatch,batchSnapshot, type ImageBatch} from './batch-model';
import type {BatchStore} from './batch-store';

function fixture(count=4) {
  let batch:ImageBatch|null=createBatch();
  const files=new Map<string,Blob>();
  for(let i=0;i<count;i++) {
    const id=crypto.randomUUID();files.set(id,new Blob(['image'+i],{type:'image/png'}));
    batch.items.push({id,requestId:crypto.randomUUID(),name:`${i}.png`,type:'image/png',state:'ready'});
  }
  const store:BatchStore={
    read:async()=>structuredClone(batch),
    update:async(id,change,edits={})=>{if(batch?.id!==id)throw Error('batch changed');batch=change(structuredClone(batch));for(const key of edits.removeFiles??[])files.delete(key);},
    readFile:async id=>files.get(id)??null,
    readPreview:async()=>null,
    add:async()=>{throw Error('not used');},
    clear:async()=>{batch=null;files.clear();},maintain:async()=>{},
  };
  return {store,files,get:()=>batch!};
}
const accepted=(i:number,status='queued')=>Response.json({generation:{generationId:i.toString(16).padStart(64,'0'),expiresAt:new Date(Date.now()+86400000).toISOString(),status,reviewBase:true}});

describe('image batch dispatch',()=>{
  it('admits all 100 while their bases are queued, with one POST in flight and no status polling',async()=>{
    const f=fixture(100),ids=new Set<string>();let submitted=0,posts=0,peak=0;
    const request=vi.fn(async(_url:string,init?:RequestInit)=>{
      if(init?.method!=='POST')throw Error('unexpected status poll');
      posts++;peak=Math.max(peak,posts);const body=init.body as FormData;
      ids.add(String(body.get('requestId')));expect(body.get('prompt')).toBe('');expect(body.has('displayName')).toBe(false);
      await new Promise(resolve=>setTimeout(resolve,0));posts--;return accepted(++submitted,'queued');
    });
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,wait:async()=>{throw Error('server still has capacity');},remember:()=>true});
    expect(submitted).toBe(100);expect(ids.size).toBe(100);expect(peak).toBe(1);expect(request).toHaveBeenCalledTimes(100);
    expect(f.get().items.filter(x=>x.receipt)).toHaveLength(100);expect(f.files.size).toBe(0);
  });
  it('keeps the same UUID and bytes after a lost response, and records acceptance once',async()=>{
    const f=fixture(1),ids:string[]=[],bytes:string[]=[];
    const request=vi.fn(async(_url:string,init?:RequestInit)=>{const body=init!.body as FormData;ids.push(String(body.get('requestId')));bytes.push(await (body.get('referenceImage') as Blob).text());if(ids.length===1)throw Error('lost');return accepted(1);});
    const opts={signal:new AbortController().signal,request,wait:async()=>{},remember:()=>false};
    await runBatch(f.store,{...opts,expected:batchSnapshot(f.get())});expect(f.get().items[0].state).toBe('uncertain');expect(f.files.size).toBe(1);
    await runBatch(f.store,{...opts,expected:batchSnapshot(f.get())});expect(ids[0]).toBe(ids[1]);expect(bytes[0]).toBe(bytes[1]);
    expect(f.get().items[0].receipt).toBeTruthy();expect(f.get().items[0].historyWarning).toBe(true);expect(f.files.size).toBe(0);
  });
  it('backs off queue_full 15/30/60 seconds with one UUID',async()=>{
    const f=fixture(1),waits:number[]=[],ids:string[]=[];let time=Date.now();
    const request=vi.fn(async(_url:string,init?:RequestInit)=>{ids.push(String((init!.body as FormData).get('requestId')));return ids.length<4?Response.json({code:'queue_full'},{status:429}):accepted(1);});
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,now:()=>time,wait:async ms=>{waits.push(ms);time+=ms;},remember:()=>true});
    expect(waits).toEqual([15000,30000,60000]);expect(new Set(ids).size).toBe(1);
  });
  it.each(['budget_exhausted','rate_limited','generation_paused'])('pauses on %s without admitting later files',async code=>{
    const f=fixture(4);const request=vi.fn(async()=>Response.json({code},{status:429}));
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>true});
    expect(request).toHaveBeenCalledTimes(1);expect(f.get().items.every(x=>!x.receipt)).toBe(true);expect(f.get().message).toBeTruthy();
  });
  it('fills available capacity beyond three and retries only the server-rejected row',async()=>{
    const f=fixture(8),ids:string[]=[],delays:number[]=[];let capacity=5,submitted=0;
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request:async(_url,init)=>{
      expect(init?.method).toBe('POST');ids.push(String((init!.body as FormData).get('requestId')));
      if(submitted===capacity)return Response.json({code:'queue_full'},{status:429});
      return accepted(++submitted);
    },wait:async ms=>{delays.push(ms);capacity=8;},remember:()=>true});
    expect(submitted).toBe(8);expect(ids).toHaveLength(9);expect(ids[5]).toBe(ids[6]);expect(delays).toEqual([15000]);
  });
  it('does not admit new work when rechecking a known unknown outcome fails',async()=>{
    const f=fixture(2);Object.assign(f.get().items[0],{state:'accepted',blocked:true,receipt:{generationId:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}});
    const request=vi.fn(async()=>Response.json({code:'unavailable'},{status:503}));
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>true});
    expect(request).toHaveBeenCalledTimes(1);expect(f.get().items[0].blocked).toBe(true);expect(f.get().items[1].state).toBe('ready');
  });
  it('does not turn a later queue_full into proof that a lost request was not accepted',async()=>{
    const f=fixture(2);f.get().items[0].state='uncertain';
    const request=vi.fn(async()=>Response.json({code:'queue_full'},{status:429}));
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>true});
    expect(request).toHaveBeenCalledTimes(1);expect(f.get().items[0].state).toBe('uncertain');
  });
  it('saves an in-flight receipt after pause, without dispatching the next image',async()=>{
    const f=fixture(2),c=new AbortController();const request=vi.fn(async()=>{c.abort();return accepted(1);});
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:c.signal,request,remember:()=>true});
    expect(request).toHaveBeenCalledTimes(1);expect(f.get().items[0].receipt).toBeTruthy();expect(f.files.size).toBe(1);
  });
  it('retains bytes and identity when saving a receipt aborts, then replays once',async()=>{
    const f=fixture(1),original=f.store.update;let fail=true;
    f.store.update=async(id,change,edits)=>{if(edits?.removeFiles?.length&&fail){fail=false;throw Error('IDB aborted');}return original(id,change,edits);};
    const uuid=f.get().items[0].requestId;const request=vi.fn(async()=>accepted(1));
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>true});
    expect(f.files.size).toBe(1);expect(f.get().items[0].state).toBe('uncertain');
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>true});
    expect(f.get().items[0].requestId).toBe(uuid);expect(f.get().items[0].receipt).toBeTruthy();expect(f.files.size).toBe(0);
  });
  it('never retries an accepted item when the history-warning write fails',async()=>{
    const f=fixture(1),original=f.store.update;
    f.store.update=async(id,change,edits)=>{const proposed=change(structuredClone(f.get()));if(proposed.items[0].historyWarning)throw Error('storage failed');return original(id,()=>proposed,edits);};
    const request=vi.fn(async()=>accepted(1));
    await expect(runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>false})).rejects.toThrow('Задача принята');
    expect(f.get().items[0].state).toBe('accepted');expect(f.files.size).toBe(0);
  });
  it('keeps an unknown accepted outcome blocking on resume',async()=>{
    const f=fixture(2);const response=()=>Response.json({generation:{generationId:'a'.repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString(),status:'failed',error:{code:'outcome_unknown'}}});
    const request=vi.fn(async()=>response());
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>true});
    expect(f.get().items[0].blocked).toBe(true);
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>true});
    expect(request.mock.calls).toHaveLength(2);expect(f.get().items[1].receipt).toBeUndefined();
  });
  it('never assigns a new UUID to an expired unresolved request',async()=>{
    const f=fixture(2),item=f.get().items[0];item.state='uncertain';item.firstSentAt=Date.now()-86400001;const uuid=item.requestId;
    const request=vi.fn();await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request,remember:()=>true});
    expect(request).not.toHaveBeenCalled();expect(f.get().items[0].requestId).toBe(uuid);expect(f.get().message).toContain('истёк');
  });
  it('can resume after a daily limit with the same unaccepted UUID on a later day',async()=>{
    const f=fixture(1),uuid=f.get().items[0].requestId;let time=Date.now();
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,now:()=>time,request:async()=>Response.json({code:'rate_limited'},{status:429})});
    expect(f.get().items[0].firstSentAt).toBeUndefined();time+=2*86400000;
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,now:()=>time,request:async()=>Response.json({generation:{generationId:'b'.repeat(64),expiresAt:new Date(time+86400000).toISOString(),status:'queued'}}),remember:()=>true});
    expect(f.get().items[0].receipt).toBeTruthy();expect(f.get().items[0].requestId).toBe(uuid);
  });
  it('does not delete the image for an invalid or expired receipt',async()=>{
    const f=fixture(1);
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,request:async()=>Response.json({generation:{generationId:'b'.repeat(64),expiresAt:new Date(Date.now()-1000).toISOString(),status:'queued'}})});
    expect(f.get().items[0].state).toBe('uncertain');expect(f.files.size).toBe(1);
  });
});

describe('known pre-admission rejections',()=>{
  it.each(['generation_not_configured','client_ip_unavailable'])('can resume fresh %s after a day using the same UUID and bytes',async code=>{
    const f=fixture(2),original=structuredClone(f.get());let time=Date.now();
    const request=vi.fn(async(url:string,init?:RequestInit)=>{
      expect(url).toBe('/api/pet-generations');expect(init?.method).toBe('POST');
      if(request.mock.calls.length===1)return Response.json({code},{status:503});
      return Response.json({generation:{generationId:request.mock.calls.length.toString(16).padStart(64,'0'),expiresAt:new Date(time+86400000).toISOString(),status:'queued'}});
    });
    const options={signal:new AbortController().signal,request,now:()=>time,remember:()=>true};
    await runBatch(f.store,{...options,expected:batchSnapshot(f.get())});
    expect(request).toHaveBeenCalledTimes(1);
    expect(f.get().items[0].state).toBe('ready');expect(f.get().items[0].firstSentAt).toBeUndefined();
    expect(f.get().items[1].state).toBe('ready');expect(f.files.size).toBe(2);expect(f.get().message).toBeTruthy();
    time+=2*86400000;
    await runBatch(f.store,{...options,expected:batchSnapshot(f.get())});
    expect(request).toHaveBeenCalledTimes(3);
    const bodies=request.mock.calls.map(call=>call[1]!.body as FormData);
    expect(bodies.map(body=>body.get('requestId'))).toEqual([original.items[0].requestId,original.items[0].requestId,original.items[1].requestId]);
    expect(await (bodies[0].get('referenceImage') as Blob).text()).toBe(await (bodies[1].get('referenceImage') as Blob).text());
    expect(f.get().items.every(item=>item.receipt)).toBe(true);expect(f.files.size).toBe(0);
    expect(f.get().createdAt).toBe(original.createdAt);expect(f.get().expiresAt).toBe(original.expiresAt);
  });
  it.each(['generation_not_configured','client_ip_unavailable'])('does not erase earlier uncertainty after %s',async code=>{
    const f=fixture(2),item=f.get().items[0],time=Date.now();
    item.state='uncertain';item.firstSentAt=time-1000;const original=structuredClone(item);
    const request=vi.fn(async()=>Response.json({code},{status:503}));
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,now:()=>time,request,remember:()=>true});
    expect(request).toHaveBeenCalledTimes(1);expect(f.get().items[0]).toMatchObject(original);expect(f.files.size).toBe(2);
    await runBatch(f.store,{expected:batchSnapshot(f.get()),signal:new AbortController().signal,now:()=>time+2*86400000,request,remember:()=>true});
    expect(request).toHaveBeenCalledTimes(1);expect(f.get().items[0]).toMatchObject(original);
    expect(f.get().items[1].state).toBe('ready');expect(f.get().message).toContain('истёк');
  });
});
