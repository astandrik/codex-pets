import {randomUUID,createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import sharp from 'sharp';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

it.skipIf(process.env.PET_METADATA_YDB_INTEGRATION!=='1')('recovers 25 oversized jobs through real YDB without regenerating saved bases',async()=>{
  if(process.env.YDB_PETS_ENDPOINT!=='grpc://127.0.0.1:23136'||process.env.YDB_PETS_DATABASE!=='/local')throw Error('disposable database required');
  const {withSession,TypedValues,destroyYdbDriver}=await import('@/lib/ydb/client');
  const {generationStore}=await import('./store');
  const {createGenerationService}=await import('./service');
  const {createSpriteGenerationWorker}=await import('./sprite-worker');
  const now=Date.now(),expires=now+86400000;
  const inputs=Array.from({length:25},()=>({requestId:randomUUID(),prompt:'Synthetic'}));
  vi.stubEnv('PET_GENERATION_PROVIDER_CALLS','20');vi.stubEnv('PET_GENERATION_QUEUE_LIMIT','30');
  const directory=await mkdtemp(path.join(tmpdir(),'metadata-ydb-backup-'));
  const cli=async(args:string[])=>{
    const result=await promisify(execFile)(process.execPath,['scripts/clean-generation-metadata.mjs',...args],{timeout:90000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,NODE_ENV:'test',YDB_PETS_ENDPOINT:process.env.YDB_PETS_ENDPOINT,YDB_PETS_DATABASE:'/local',YDB_ANONYMOUS_CREDENTIALS:'1'}});
    return JSON.parse(result.stdout.split('\n').filter(line=>line.startsWith('{')).at(-1)!);
  };
  try {
    const {TableDescription,Column,Types}=await import('ydb-sdk');
    for(const [name,columns,keys] of [
      ['codex_pet_generation_jobs',['id','payload','expires_at'],['id']],
      ['codex_pet_generation_artifacts',['id','kind','bytes','expires_at'],['id','kind']],
      ['codex_pet_generation_quotas',['record_key','payload','expires_at'],['record_key']],
    ] as const){
      const table=new TableDescription();
      for(const column of columns)table.withColumn(new Column(column,column==='expires_at'?Types.TIMESTAMP:column==='bytes'?Types.BYTES:Types.UTF8));
      table.withPrimaryKeys(...keys);
      await withSession(session=>session.createTable(name,table));
    }
    await generationStore.transaction(tx=>tx.putLedger('scheduler',JSON.stringify({version:3,revision:0,activeLimit:2,providerLimit:20,queue:[],active:[],resumes:{},providerSlots:[],providerWaiters:[],providerTurn:null,heavy:null,tasks:[],taskTurn:null}),expires));
    const service=createGenerationService(generationStore,{enabled:()=>true,secret:()=> 'synthetic-recovery-secret',now:()=>now});
    const accepted=[];
    for(let index=0;index<25;index++)accepted.push(await service.generate(inputs[index],`203.0.113.${index+1}`,{reviewBase:true}));
    let seed=0x12345678;
    const pixels=Buffer.alloc(550*550*3);
    for(let i=0;i<pixels.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;pixels[i]=seed&255;}
    const png=await sharp(pixels,{raw:{width:550,height:550,channels:3}}).png().toBuffer();
    const hash=createHash('sha256').update(png).digest('hex');
    let rawBytes=0;
    for(let index=0;index<17;index++){
      const job=(await generationStore.readJob(accepted[index].generationId))!;
      const payload=JSON.stringify({...job,status:'generating',stages:[{name:'base',status:'completed',startedAt:now,sha256:hash,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:0.04},generationMs:1,bytes:png}],unknownNumber:'keep'});
      rawBytes+=Buffer.byteLength(payload);
      await withSession(session=>session.executeQuery('DECLARE $id AS Utf8; DECLARE $payload AS Utf8; DECLARE $expires AS Timestamp; UPSERT INTO codex_pet_generation_jobs (id,payload,expires_at) VALUES ($id,$payload,$expires);',{$id:TypedValues.utf8(job.id),$payload:TypedValues.utf8(payload),$expires:TypedValues.timestamp(new Date(expires))}));
      await generationStore.transaction(tx=>tx.putArtifact(job.id,'stage-base.png',png,expires));
    }
    expect(rawBytes).toBeGreaterThan(48*1024*1024);
    const ids=accepted.map(reply=>reply.generationId);
    const unboundedRead=()=>withSession(session=>session.executeQuery("DECLARE $ids AS List<Utf8>; SELECT id,payload FROM codex_pet_generation_jobs WHERE id IN $ids;",{$ids:TypedValues.list(Types.UTF8,ids)}));
    await expect(unboundedRead()).rejects.toThrow(/result size limit/i);
    expect((await generationStore.transaction(tx=>tx.getJobs(ids))).size).toBe(25);
    const summaries=await generationStore.transaction(tx=>tx.getQueueJobs(ids));
    expect(summaries.size).toBe(25);expect(JSON.stringify([...summaries]).length).toBeLessThan(8192);
    const idsFile=path.join(directory,'ids.json'),manifestFile=path.join(directory,'manifest.json'),backupFile=path.join(directory,'backup.json');
    await writeFile(idsFile,JSON.stringify(ids),{mode:0o600});
    const dry=await cli(['--ids-file='+idsFile,'--manifest='+manifestFile]);
    expect(dry.manifest.entries.filter((row:{status:string})=>row.status==='eligible')).toHaveLength(17);
    const args=['--manifest='+manifestFile,'--backup='+backupFile,'--expected-manifest-sha256='+dry.manifestSha256];
    expect((await cli(['--apply',...args])).changed).toHaveLength(17);
    const backup=JSON.parse(await readFile(backupFile,'utf8'));
    expect(backup.rows).toHaveLength(17);
    expect((await cli(['--apply',...args])).changed).toEqual([]);
    expect((await cli(['--restore',...args])).changed).toHaveLength(17);
    await expect(unboundedRead()).rejects.toThrow(/result size limit/i);
    expect((await generationStore.transaction(tx=>tx.getJobs(ids))).size).toBe(25);
    await cli(['--apply',...args]);
    expect((await generationStore.transaction(tx=>tx.getJobs(ids))).size).toBe(25);
    for(let index=0;index<17;index++){
      expect((await generationStore.readArtifact(ids[index],'stage-base.png',now))!.equals(png)).toBe(true);
      expect((await service.generate(inputs[index],`203.0.113.${index+1}`,{reviewBase:true})).generationId).toBe(ids[index]);
    }
    // One known terminal failure; seven untouched inputs still need their first provider call.
    await generationStore.transaction(async tx=>{
      const failed=(await tx.getJob(ids[17]))!;
      await tx.putJob({...failed,status:'failed',error:'provider_rejected'});
    });
    const calls:string[]=[];
    const worker=createSpriteGenerationWorker({store:generationStore,service,now:()=>now,renderer:{open:async job=>({prepare:async()=>{},cleanup:async()=>{},compose:async()=>png,generate:async()=>{calls.push(job.id);return {bytes:png,generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:0.04}};}})}});
    for(let attempt=0;attempt<60;attempt++){
      const status=await worker('synthetic-worker-'+attempt);
      if(status==='idle')break;
    }
    expect(calls).toHaveLength(7);expect(new Set(calls).size).toBe(7);expect(calls.every(id=>ids.slice(18).includes(id))).toBe(true);
    for(const id of [...ids.slice(0,17),...ids.slice(18)])expect((await generationStore.readJob(id))?.status).toBe('awaiting_confirmation');
    for(const reply of accepted)expect((await generationStore.readJob(reply.generationId))?.expiresAt).toBe(Date.parse(reply.expiresAt));
    console.log(JSON.stringify({rawBytes,rows:25,cleaned:17,providerCalls:calls.length,savedBasesRegenerated:0,restoreVerified:true}));
  } finally {vi.unstubAllEnvs();await destroyYdbDriver();await rm(directory,{recursive:true,force:true});}
},180000);
