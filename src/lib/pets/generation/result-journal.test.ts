import {mkdtemp,readFile,writeFile,symlink,stat,rm,cp,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import path from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {FileResultJournal,journalKey} from './result-journal';
const roots:string[]=[];
const identity={jobId:'a'.repeat(64),inputHash:'f'.repeat(64),promptHash:'f'.repeat(64),createdAt:1000,expiresAt:1000000,operationKey:'attempt:token',receiptKey:'attempt:token',leaseId:'lease',owner:'owner',taskKey:'image:idle',kind:'image' as const,stage:'idle' as const,pipelineVersion:2};
async function fixture(capacity=512*1024*1024){const root=await mkdtemp(path.join(tmpdir(),'result-journal-test-'));roots.push(root);return {root,journal:await FileResultJournal.open(root,{capacityBytes:capacity})};}
afterEach(async()=>{for(const p of roots.splice(0))await rm(p,{recursive:true,force:true});});
it('publishes received bytes durably and reads them after reopening with private permissions',async()=>{
 const {root,journal}=await fixture();const key=await journal.reserve(identity);
 await journal.publish(key,{kind:'image',bytes:Buffer.from('image'),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}});
 const restarted=await FileResultJournal.open(root);const result=await restarted.read(key,2000);
 expect(result?.outcome).toMatchObject({kind:'image',bytes:Buffer.from('image')});
 expect(result?.identity).toMatchObject(identity);expect((await stat(root)).mode&0o077).toBe(0);
 await restarted.confirm(key,result!.fingerprint);expect(await restarted.read(key,2000)).toBeNull();
});
it('never replaces another result under the same operation and refuses path traversal',async()=>{
 const {journal}=await fixture();const key=await journal.reserve(identity);
 await journal.publish(key,{kind:'image',bytes:Buffer.from('one'),generationMs:1});
 await expect(journal.publish(key,{kind:'image',bytes:Buffer.from('two'),generationMs:1})).rejects.toThrow();
 await expect(journal.read('../outside',2000)).rejects.toThrow();
});
it('reserves shared capacity before a provider call and does not evict pending outcomes',async()=>{
 const {root,journal}=await fixture(FileResultJournal.reservationBytes);
 await journal.reserve(identity);
 const peer=await FileResultJournal.open(root,{capacityBytes:FileResultJournal.reservationBytes});
 await expect(peer.reserve({...identity,operationKey:'other',receiptKey:'other'})).rejects.toThrow('journal_capacity');
 expect(await peer.reserve(identity)).toBe(journalKey(identity));
});
it('ignores unfinished publication, rejects corruption, and expires image bytes without extending accounting TTL',async()=>{
 const {root,journal}=await fixture();const key=await journal.reserve(identity);
 expect(await journal.read(key,2000)).toBeNull();
 await journal.publish(key,{kind:'image',bytes:Buffer.from('one'),generationMs:1});
 const record=await journal.read(key,identity.expiresAt);
 expect(record?.outcome).toBeNull();
 expect(record?.fingerprint).toHaveLength(64);
 await journal.expire(identity.expiresAt);
 await expect(readFile(path.join(root,'records',key,'ready','payload'))).rejects.toMatchObject({code:'ENOENT'});
 expect(await journal.read(key,identity.createdAt+7*86400000)).toBeNull();
 const k=await journal.reserve({...identity,operationKey:'new',receiptKey:'new'});
 await journal.publish(k,{kind:'image',bytes:Buffer.from('original'),generationMs:1});
 await writeFile(path.join(root,'records',k,'ready','payload'),'corrupt');
 await expect(journal.read(k,2000)).rejects.toThrow('journal_corrupt');
});
it('rejects a symlink root and preserves unknown/incomplete reservations',async()=>{
 const {root}=await fixture();const target=path.join(root,'link');await symlink(root,target);
 await expect(FileResultJournal.open(target)).rejects.toThrow();
});
it('opens concurrently and reserves capacity consistently across independent instances',async()=>{
 const {root}=await fixture(FileResultJournal.reservationBytes*2);
 const [a,b]=await Promise.all([FileResultJournal.open(root,{capacityBytes:FileResultJournal.reservationBytes*2}),FileResultJournal.open(root,{capacityBytes:FileResultJournal.reservationBytes*2})]);
 const keys=await Promise.all([a.reserve(identity),b.reserve({...identity,jobId:'b'.repeat(64)})]);
 expect(new Set(keys).size).toBe(2);
 await expect(a.reserve({...identity,jobId:'c'.repeat(64)})).rejects.toThrow('journal_capacity');
 const before=await readFile(path.join(root,'records',keys[0],'intent.json'));
 const readonly=await FileResultJournal.openExisting(root);expect(await readonly.read(keys[0],2000)).toBeNull();
 expect(await readFile(path.join(root,'records',keys[0],'intent.json'))).toEqual(before);
});
it('rejects altered accounting metadata even when the image payload is intact',async()=>{
 const {root,journal}=await fixture();const key=await journal.reserve(identity);
 await journal.publish(key,{kind:'image',bytes:Buffer.from('valid'),generationMs:1,usage:{textInputTokens:0,imageInputTokens:0,outputTokens:0,costUsd:.04}});
 const file=path.join(root,'records',key,'ready','manifest.json'),value=JSON.parse((await readFile(file)).toString());value.costUsd=400;
 await writeFile(file,JSON.stringify(value));await expect(journal.read(key,2000)).rejects.toThrow('journal_corrupt');
});

it('allows two readers to confirm the same receipt without losing a slot',async()=>{
 const {root,journal}=await fixture();const other=await FileResultJournal.openExisting(root),key=await journal.reserve(identity);
 const fingerprint=await journal.publish(key,{kind:'image',bytes:Buffer.from('same'),generationMs:1});
 await Promise.all([journal.confirm(key,fingerprint),other.confirm(key,fingerprint)]);
 expect(await journal.list()).toEqual([]);expect(await journal.reserve({...identity,operationKey:'again',receiptKey:'again'})).toHaveLength(64);
});
it('does not release a new reservation when an old retirement record reappears',async()=>{
 const {root,journal}=await fixture(FileResultJournal.reservationBytes),key=await journal.reserve(identity);
 const fingerprint=await journal.publish(key,{kind:'image',bytes:Buffer.from('old'),generationMs:1});
 const intent=JSON.parse((await readFile(path.join(root,'records',key,'intent.json'))).toString()),backup=path.join(root,'retired-copy');
 await cp(path.join(root,'records',key),backup,{recursive:true});await journal.confirm(key,fingerprint);
 const replacement={...identity,operationKey:'replacement',receiptKey:'replacement'},next=await journal.reserve(replacement);
 await mkdir(path.join(root,'retired'),{recursive:true});await cp(backup,path.join(root,'retired',`${key}-${intent.reservationId}`),{recursive:true});
 await journal.expire(2000);expect(await journal.reserve(replacement)).toBe(next);
 await expect(journal.reserve({...identity,operationKey:'third',receiptKey:'third'})).rejects.toThrow('journal_capacity');
});
