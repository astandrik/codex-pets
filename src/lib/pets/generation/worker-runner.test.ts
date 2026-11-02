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
