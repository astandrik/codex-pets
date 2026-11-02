import {expect,it} from 'vitest';
import {retryCheckpoint} from './checkpoint-retry';
it('bounds database-only retries and succeeds without changing the operation',async()=>{
 let calls=0,now=0;const delays:number[]=[];
 const result=await retryCheckpoint(async()=>{if(++calls<5)throw Error('conflict');return 'same-result';},
  {now:()=>now,wait:async ms=>{delays.push(ms);now+=ms;},random:()=>1});
 expect(result).toBe('same-result');expect(calls).toBe(5);expect(delays).toEqual([250,500,1000,2000]);
});
it('does not start another transaction after the budget or a terminal failure',async()=>{
 let now=0,calls=0;const original=Error('conflict');
 await expect(retryCheckpoint(async()=>{calls++;throw original;},{now:()=>now,wait:async ms=>{now+=ms;},random:()=>1,budgetMs:200})).rejects.toBe(original);
 expect(calls).toBe(1);
 await expect(retryCheckpoint(async()=>{throw original;},{shouldRetry:()=>false})).rejects.toBe(original);
});
