import {afterEach,expect,it,vi} from 'vitest';import {configuredResultJournal} from './result-journal-runtime';
import {access,mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
const directories:string[]=[];afterEach(async()=>{for(const directory of directories.splice(0))await rm(directory,{recursive:true,force:true});});
it('leaves the feature off by default and rejects incomplete or invalid enabled configuration',async()=>{
 expect(await configuredResultJournal({})).toBeUndefined();expect(await configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'false'})).toBeUndefined();
 await expect(configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'yes'})).rejects.toThrow();
 await expect(configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'true'})).rejects.toThrow();
 await expect(configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'true',PET_GENERATION_RESULT_JOURNAL_DIR:'relative'})).rejects.toThrow();
});
it.each([1,2])('rejects scheduler v%s before creating a journal or starting provider work',async version=>{
 const parent=await mkdtemp(path.join(tmpdir(),'journal-runtime-'));directories.push(parent);const directory=path.join(parent,'journal');
 const read=vi.fn(async()=>version===1?{revision:0,queue:[],active:null}:{version:2 as const,revision:0,activeLimit:1 as const,providerLimit:11,queue:[],active:[],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null});
 await expect(configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'true',PET_GENERATION_RESULT_JOURNAL_DIR:directory},read)).rejects.toMatchObject({code:'journal_requires_scheduler_v3'});
 expect(read).toHaveBeenCalledTimes(1);await expect(access(directory)).rejects.toMatchObject({code:'ENOENT'});
});
it('does not read the scheduler while the journal is disabled',async()=>{
 const read=vi.fn(async()=>{throw Error('unexpected read');});expect(await configuredResultJournal({},read)).toBeUndefined();expect(read).not.toHaveBeenCalled();
});
it('opens the private journal with scheduler v3',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'journal-runtime-'));directories.push(directory);
 const journal=await configuredResultJournal({PET_GENERATION_RESULT_JOURNAL_ENABLED:'true',PET_GENERATION_RESULT_JOURNAL_DIR:directory},async()=>({version:3,revision:0,activeLimit:2,providerLimit:20,queue:[],active:[],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null}));
 expect(await journal?.list()).toEqual([]);
});
