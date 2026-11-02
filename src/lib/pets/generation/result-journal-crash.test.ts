import {mkdtemp,readdir,readFile,rm,utimes,rename} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {afterEach,expect,it} from 'vitest';import {FileResultJournal} from './result-journal';
const folders:string[]=[];afterEach(async()=>{for(const p of folders.splice(0))await rm(p,{recursive:true,force:true});});
const next={jobId:'b'.repeat(64),inputHash:'f'.repeat(64),promptHash:'f'.repeat(64),createdAt:1000,expiresAt:1000000,operationKey:'attempt:two',receiptKey:'attempt:two',leaseId:'lease',owner:'owner',taskKey:'image:idle',kind:'image' as const,stage:'idle' as const,pipelineVersion:2};
async function crash(phase:string){const folder=await mkdtemp(path.join(tmpdir(),'journal-crash-test-'));folders.push(folder);await expect(promisify(execFile)(process.execPath,['scripts/lib/result-journal-crash-probe.mjs',folder,phase],{timeout:10000})).rejects.toMatchObject({code:73});return folder;}
it.each(['confirm','slot','partial-slot'])('finishes retirement after a process stops at %s without leaking its capacity',async phase=>{
 const folder=await crash(phase);const journal=await FileResultJournal.open(folder,{capacityBytes:FileResultJournal.reservationBytes});
 expect(await journal.list()).toEqual([]);await expect(journal.reserve(next)).resolves.toHaveLength(64);
});
it('deletes unpublished payloads at the original expiry while preserving accounting metadata',async()=>{
 const folder=await crash('publish'),journal=await FileResultJournal.openExisting(folder);const [key]=await journal.list();
 const record=path.join(folder,'records',key);const [temporary]=(await readdir(record)).filter(n=>n.startsWith('publish-'));
 expect((await readFile(path.join(record,temporary,'payload'))).length).toBeGreaterThan(0);
 await journal.expire(next.expiresAt);await expect(readFile(path.join(record,temporary,'payload'))).rejects.toMatchObject({code:'ENOENT'});
 expect(await readFile(path.join(record,'intent.json'))).toBeDefined();expect(await journal.read(key,next.expiresAt)).toBeNull();
});

it('completes retirement even after intent was deleted by an interrupted recursive remove',async()=>{
 const folder=await crash('partial-retired');const journal=await FileResultJournal.open(folder,{capacityBytes:FileResultJournal.reservationBytes});
 await journal.expire(next.createdAt+8*86400000);expect(await readdir(path.join(folder,'retired'))).toEqual([]);
 await expect(journal.reserve(next)).resolves.toHaveLength(64);
});
it('allows at most one reservation while an old cleaner overlaps a new claim',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'journal-crash-test-'));folders.push(folder);
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/lib/result-journal-crash-probe.mjs',folder,'race'],{timeout:10000});
 expect(JSON.parse(stdout)).toEqual({reservations:1,rejected:1});
});
it.each(['reserve','reserve-record'])('reclaims a reservation interrupted at %s after its original receipt deadline',async phase=>{
 const folder=await crash(phase),journal=await FileResultJournal.open(folder,{capacityBytes:FileResultJournal.reservationBytes});
 const slot=path.join(folder,'slots','0'),[nonce]=await readdir(slot);
 expect(await readFile(path.join(slot,nonce,'key'),'utf8')).toHaveLength(64);
 expect(JSON.parse(await readFile(path.join(slot,nonce,'intent.json'),'utf8'))).toMatchObject({reservationId:nonce,slot:0,identity:{jobId:'a'.repeat(64),operationKey:'attempt:one'}});
 await journal.expire(next.createdAt+7*86400000-1);
 await expect(journal.reserve(next)).rejects.toThrow('journal_capacity');
 await Promise.all([journal.expire(next.createdAt+7*86400000),journal.expire(next.createdAt+7*86400000)]);
 await expect(journal.reserve(next)).resolves.toHaveLength(64);
});
it.each(['nonce','flat'])('reclaims %s legacy orphan slots without a saved deadline conservatively',async layout=>{
 const folder=await crash('reserve'),journal=await FileResultJournal.openExisting(folder);
 const slot=path.join(folder,'slots','0'),[nonce]=await readdir(slot),owned=path.join(slot,nonce);
 await rm(path.join(owned,'intent.json'),{force:true});await utimes(owned,new Date(1000),new Date(1000));
 if(layout==='flat'){await rename(path.join(owned,'key'),path.join(slot,'key'));await rm(owned,{recursive:true});await utimes(slot,new Date(1000),new Date(1000));}
 await journal.expire(1000+7*86400000-1);await expect(journal.reserve(next)).rejects.toThrow('journal_capacity');
 await journal.expire(1000+7*86400000);await expect(journal.reserve(next)).resolves.toHaveLength(64);
});
it('finishes orphan cleanup when a process stopped after deleting its key',async()=>{
 const folder=await crash('orphan-partial-slot'),journal=await FileResultJournal.open(folder,{capacityBytes:FileResultJournal.reservationBytes});
 await journal.expire(next.createdAt+8*86400000);await expect(journal.reserve(next)).resolves.toHaveLength(64);
});
it('keeps a live reservation while another process checks orphan expiry',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'journal-crash-test-'));folders.push(folder);
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/lib/result-journal-crash-probe.mjs',folder,'active-reserve'],{timeout:10000});
 expect(JSON.parse(stdout)).toMatchObject({competitorBlocked:true,identity:{jobId:'a'.repeat(64),operationKey:'attempt:one',leaseId:'lease'}});
});
it('cannot delete a replacement reservation during orphan cleanup',async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),'journal-crash-test-'));folders.push(folder);
 const {stdout}=await promisify(execFile)(process.execPath,['scripts/lib/result-journal-crash-probe.mjs',folder,'orphan-race'],{timeout:10000});
 expect(JSON.parse(stdout)).toEqual({reservations:1,rejected:1});
});
