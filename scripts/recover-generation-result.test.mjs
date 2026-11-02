import {expect,it,vi} from 'vitest';import {parseRecoveryArgs,runRecoveryCommand} from './recover-generation-result.mjs';
const record='a'.repeat(64),base=[`--record=${record}`,'--journal-dir=/private/journal'];
it('defaults to dry-run and does not confirm or write backup',async()=>{
 const confirm=vi.fn(),backup=vi.fn(),recover=vi.fn(async()=>({mode:'image',applied:false}));
 const deps={openJournal:async()=>({read:async()=>({identity:{jobId:'id'},fingerprint:'f'}),confirm}),snapshot:async()=>({revision:1,jobHash:'h'}),recover,backup};
 const result=await runRecoveryCommand(base,deps);expect(result.applied).toBe(false);expect(backup).not.toHaveBeenCalled();expect(confirm).not.toHaveBeenCalled();expect(recover.mock.calls[0][1].apply).toBe(false);
});
it('requires explicit expectations and a private backup destination for apply',()=>{
 expect(()=>parseRecoveryArgs([...base,'--apply'])).toThrow();
 expect(parseRecoveryArgs([...base,'--apply','--expected-revision=1','--expected-job-hash=absent','--backup=/private/backup'])).toMatchObject({apply:true,expectedJobHash:null});
 expect(()=>parseRecoveryArgs([...base,'--record=../file'])).toThrow();
});
