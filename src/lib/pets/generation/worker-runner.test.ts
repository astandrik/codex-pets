import {expect, it} from "vitest";
import {runWorkerPool} from "./worker-runner";

it("runs at most two slices, joins in-flight work on stop and uses distinct claim owners", async () => {
  const controller = new AbortController();
  const releases: (() => void)[] = [], owners: string[] = [];
  let active = 0, maximum = 0;
  const result = runWorkerPool({maxActiveJobs: 2, signal: controller.signal,
    runOnce: async owner => {owners.push(owner); active++; maximum = Math.max(maximum, active);
      await new Promise<void>(resolve => releases.push(resolve)); active--; return "yielded";}});
  await new Promise(resolve => setImmediate(resolve));
  expect(releases).toHaveLength(2);
  controller.abort(); releases.forEach(release => release()); await result;
  expect(maximum).toBe(2); expect(active).toBe(0); expect(new Set(owners).size).toBe(2);
});

it("once executes exactly one slice even when the configured pool has two slots", async () => {
  let calls = 0;
  await runWorkerPool({maxActiveJobs: 2, once: true, signal: new AbortController().signal,
    runOnce: async () => {calls++; return "idle";}});
  expect(calls).toBe(1);
});

it("yields the event loop between ready slices so provider timers and shutdown are not starved", async () => {
  const controller = new AbortController();
  let calls = 0, timerRan = false;
  const timer = setImmediate(() => {timerRan = true; controller.abort();});
  try {
    await runWorkerPool({maxActiveJobs: 1, signal: controller.signal, runOnce: async () => {
      calls++;
      if (calls === 10) controller.abort();
      return "yielded";
    }});
    expect(timerRan).toBe(true);
    expect(calls).toBeLessThan(10);
  } finally {clearImmediate(timer);}
});

it("joins active peers when reading the next wake time fails", async () => {
  const controller = new AbortController();
  let calls = 0, release!: () => void, finished = false;
  const peer = new Promise<void>(resolve => {release = resolve;});
  const running = runWorkerPool({maxActiveJobs: 2, signal: controller.signal,
    runOnce: async () => {if (++calls === 1) return "idle"; await peer; return "completed";},
    delay: async () => {controller.abort(); throw Error("temporary DB failure");}}).finally(() => {finished = true;});
  // Attach a rejection handler before observing the join contract.
  const outcome = running.catch(error => error);
  await new Promise(resolve => setImmediate(resolve));
  const joinedEarly = finished;
  release();
  expect(await outcome).toBeUndefined();
  expect(joinedEarly).toBe(false);
});

it('reports the failed phase and keeps the old status callback', async()=>{
 const errors:unknown[]=[],statuses:string[]=[];
 await runWorkerPool({maxActiveJobs:1,once:true,signal:new AbortController().signal,
  runOnce:async(_owner,context)=>{context!.phase='claim';throw Error('private');},
  onError:(error,context)=>errors.push({error,phase:context.phase}),onResult:s=>statuses.push(s)});
 expect(errors).toHaveLength(1);expect(errors[0]).toMatchObject({phase:'claim'});expect(statuses).toEqual(['iteration_failed']);
});

it('backs off failed iterations instead of using the ready-task 50ms delay',async()=>{
 const {vi}=await import('vitest');vi.useFakeTimers();const c=new AbortController();let count=0;
 const result=runWorkerPool({maxActiveJobs:1,signal:c.signal,random:()=>0,delay:async()=>50,
  runOnce:async()=>{count++;if(count===2)c.abort();throw Error('temporary database conflict');}});
 try{await vi.advanceTimersByTimeAsync(249);expect(count).toBe(1);await vi.advanceTimersByTimeAsync(1);expect(count).toBe(2);await result;}
 finally{c.abort();await result;vi.useRealTimers();}
});
