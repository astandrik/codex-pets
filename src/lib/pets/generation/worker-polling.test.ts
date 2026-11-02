import {afterEach,expect,it,vi} from 'vitest';
import {taskFixture} from './task-pool.test-utils';import {runWorkerPool} from './worker-runner';
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.useRealTimers();});
it('keeps twenty paused loops below ten transactions per second without scheduler writes',async()=>{
 vi.useFakeTimers();const f=await taskFixture();const row=f.store.ledger.get('scheduler')!;
 row.value=JSON.stringify({...JSON.parse(row.value),pauseReason:'outcome_unknown'});
 await f.service.claim('warmup');const original=f.store.ledger.get('scheduler')!.value;
 const tx=vi.spyOn(f.store,'transaction');const stop=new AbortController();
 const pending=runWorkerPool({maxActiveJobs:20,signal:stop.signal,runOnce:async owner=>await f.service.claim(owner)?'yielded':'idle',delay:()=>f.service.nextWakeDelay()});
 try{await vi.advanceTimersByTimeAsync(30000);expect(tx.mock.calls.length).toBeLessThanOrEqual(300);expect(f.store.ledger.get('scheduler')!.value).toBe(original);}
 finally{stop.abort();await pending;}
});
