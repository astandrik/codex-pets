import {expect,it} from "vitest";
import {taskSchedulerSchema} from "./model";
import {nextTaskWakeDelay, taskResourcesAvailable} from "./task-readiness";
const task = (kind="image", notBefore=0) => ({key:"task",jobId:"a".repeat(64),kind,status:"ready",notBefore,attempt:"initial"});
const state = (tasks: ReturnType<typeof task>[] = []) => taskSchedulerSchema.parse({version:3,revision:0,queue:[],active:[],activeLimit:2,providerLimit:20,providerSlots:[],providerWaiters:[],providerTurn:null,resumes:{},heavy:null,tasks,taskTurn:null});
it("waits five seconds for empty, paused or draining work without preventing local finalization",()=>{
 const empty=state();expect(nextTaskWakeDelay(empty,100)).toBe(5000);
 const paused={...state([task()]),pauseReason:"outcome_unknown"};
 expect(nextTaskWakeDelay(paused,100)).toBe(5000);
 expect(nextTaskWakeDelay(state([task()]),100,true)).toBe(5000);
 const local={...state([task("package")]),pauseReason:"outcome_unknown"};
 expect(nextTaskWakeDelay(local,100)).toBe(50);expect(taskResourcesAvailable(local.tasks[0],local)).toBe(true);
});
it("uses capacity backoff and the real notBefore deadline",()=>{
 const full=state([task()]);full.providerLimit=1;
 full.providerSlots=[{jobId:"b".repeat(64),key:"busy",owner:"o",leaseId:"l",startedAt:0}];
 expect(nextTaskWakeDelay(full,100)).toBe(500);
 expect(nextTaskWakeDelay(state([task("image",400)]),100)).toBe(300);
 const heavy=state([task("compose")]);heavy.heavy={jobId:"b".repeat(64),owner:"o",leaseId:"l"};
 expect(nextTaskWakeDelay(heavy,100)).toBe(500);
});
