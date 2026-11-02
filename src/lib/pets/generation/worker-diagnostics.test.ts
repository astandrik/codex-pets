import {expect,it,vi} from 'vitest';
import {createWorkerContext,logWorkerFailure,setWorkerPhase} from './worker-diagnostics';
import {GenerationError} from './model';
import {YdbError} from '@/lib/ydb/client';
it('logs bounded phase and YDB code without exception text, identifiers or payload',()=>{
 class Aborted extends YdbError {static status=400040;}
 const context=createWorkerContext('private-owner',()=>{},()=>1000);
 setWorkerPhase(context,'checkpoint',{id:'a'.repeat(64),workerTask:{kind:'image',stage:'idle',key:'private-key'}});
 const write=vi.fn();logWorkerFailure(new Aborted('private SQL and password'),context,false,write,()=>1500);
 const entry=JSON.parse(write.mock.calls[0][0]);
 expect(entry).toMatchObject({operation:'pet-generation-worker-error',phase:'checkpoint',errorClass:'YdbError',databaseStatus:400040,stage:'idle',task:'image',elapsedMs:500,secondary:false});
 expect(write.mock.calls[0][0]).not.toMatch(/private|password|aaaaa/);
});
it('does not log an arbitrary generation code and never throws from the logger',()=>{
 const context=createWorkerContext('owner',()=>{},()=>1000), write=vi.fn();
 logWorkerFailure(new GenerationError('private-key-value'),context,false,write);
 expect(write.mock.calls[0][0]).not.toContain('private-key-value');
 expect(()=>logWorkerFailure(Error('secret'),context,false,()=>{throw Error('logger');})).not.toThrow();
});
