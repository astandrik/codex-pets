import {expect,it,vi} from 'vitest';
import {parseDiagnosticArgs,runDiagnosticCli} from './diagnose-generation.mjs';

const ids=['a'.repeat(64),'b'.repeat(64)],revisions=['c'.repeat(64),'d'.repeat(64)];
const args=['--job-id',ids[0],'--job-id',ids[1]];
const env={YDB_PETS_ENDPOINT:'grpc://test.invalid:2136',YDB_PETS_DATABASE:'/test'};
it('defaults to dry-run and requires exactly two explicit distinct IDs',()=>{
 expect(parseDiagnosticArgs(args)).toEqual({mode:'dry-run',ids,expectedRevisions:[]});
 for(const value of [[],args.slice(0,2),[...args,'--job-id','e'.repeat(64)],['--job-id',ids[0],'--job-id',ids[0]],[...args,'--apply'],[...args,'--secret','private'],[...args,'--dry-run','--apply']])expect(()=>parseDiagnosticArgs(value)).toThrow('invalid_arguments');
});
it('does not load a database for help or an absent explicit target',async()=>{
 const load=vi.fn();expect(await runDiagnosticCli(['--help'],{load,write:()=>{}})).toBe(0);
 await expect(runDiagnosticCli(args,{load,env:{},write:()=>{}})).rejects.toThrow('explicit');expect(load).not.toHaveBeenCalled();
});
it('diagnoses sequentially without writes or exposing private runtime fields',async()=>{
 const diagnose=vi.fn(async id=>({sourceId:id,sourceRevision:revisions[ids.indexOf(id)],status:'invalid',issues:[],changed:true,private:'secret'}));
 const apply=vi.fn(),dispose=vi.fn(),write=vi.fn();
 expect(await runDiagnosticCli(args,{load:async()=>({diagnose,apply,dispose}),write,env})).toBe(0);
 expect(diagnose.mock.calls).toEqual([[ids[0]],[ids[1]]]);expect(apply).not.toHaveBeenCalled();expect(dispose).toHaveBeenCalledOnce();
 expect(write.mock.calls[0][0]).not.toContain('secret');expect(write.mock.calls[0][0]).not.toContain(ids[0]);
});
it('forwards explicit apply revisions and always closes the database on conflict',async()=>{
 const apply=vi.fn(async()=>{throw Error('continuation_source_conflict');}),dispose=vi.fn();
 const diagnose=vi.fn(async()=>({status:'invalid',issues:[]}));
 await expect(runDiagnosticCli([...args,'--apply','--expected-revision',revisions[0],'--expected-revision',revisions[1]],{load:async()=>({diagnose,apply,dispose}),write:()=>{},env})).rejects.toThrow('continuation_source_conflict');
 expect(apply.mock.calls[0][1]).toEqual(revisions);expect(dispose).toHaveBeenCalledOnce();
});
it('returns failure for unknown atlas validation without applying or exposing renderer details',async()=>{
 const diagnose=vi.fn(async()=>({sourceRevision:revisions[0],status:'unknown',issues:[],diagnostic:{boundary:'artifact',reason:'invalid_image'},changed:false}));
 const apply=vi.fn(),dispose=vi.fn(),write=vi.fn();
 expect(await runDiagnosticCli(args,{load:async()=>({diagnose,apply,dispose}),write,env})).toBe(1);
 expect(JSON.parse(write.mock.calls[0][0]).jobs.every(job=>job.status==='unknown')).toBe(true);
 expect(apply).not.toHaveBeenCalled();expect(dispose).toHaveBeenCalledOnce();
});
