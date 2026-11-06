// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {HISTORY_PREFIX,HISTORY_V2_PREFIX,rememberGenerationVersion,readGenerationHistory,parseHistoryGeneration,pruneGenerationHistory,rememberGenerationSubmission,SUBMISSION_HISTORY_PREFIX} from './history';
const now=Date.parse('2026-11-06T12:00:00Z'),day=86400000,id='a'.repeat(64);
const receipt={petId:'pet_example',slug:'example',submittedAt:new Date(now).toISOString()};
const generation={generationId:id,createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+day).toISOString(),status:'completed',progress:{completedSteps:12,totalSteps:12},submission:receipt};
beforeEach(()=>localStorage.clear());
it('parses the existing submission receipt and rejects malformed proof',()=>{
 expect(parseHistoryGeneration(generation,id)?.submission).toEqual(receipt);
 expect(parseHistoryGeneration({...generation,submission:{...receipt,slug:'../bad'}},id)).toBeNull();
});
it('retains confirmed submission through old writes and expiry without changing UUID data',()=>{
 localStorage.setItem('pending-request-uuid','unchanged');
 expect(rememberGenerationVersion(generation,undefined,now)).toBe(true);
 const before=localStorage.length;
 rememberGenerationVersion(generation,undefined,now+1);
 expect(localStorage.length).toBe(before);
 rememberGenerationVersion({...generation,submission:undefined},undefined,now+2);
 localStorage.setItem(HISTORY_PREFIX+id,JSON.stringify({generationId:id,savedAt:now,expiresAt:now+day}));
 expect(readGenerationHistory(now+2).entries[0].submission).toEqual(receipt);
 pruneGenerationHistory(now+2*day);
 expect(readGenerationHistory(now+2*day).entries[0].submission).toEqual(receipt);
 pruneGenerationHistory(now+8*day);
 expect(readGenerationHistory(now+8*day).entries).toEqual([]);
 expect(localStorage.getItem('pending-request-uuid')).toBe('unchanged');
});

afterEach(()=>vi.restoreAllMocks());
it('does not replace confirmed proof or extend its retention on replay',()=>{
 rememberGenerationVersion(generation,undefined,now);
 const key=SUBMISSION_HISTORY_PREFIX+id,raw=localStorage.getItem(key);
 expect(rememberGenerationSubmission(id,new Date(now+2*day).toISOString(),receipt,now+day)).toBe(true);
 expect(localStorage.getItem(key)).toBe(raw);
 expect(rememberGenerationSubmission(id,generation.expiresAt,{...receipt,petId:'other'},now)).toBe(false);
 expect(localStorage.getItem(key)).toBe(raw);
});
it('reports storage failure without touching recovery or existing history',()=>{
 rememberGenerationVersion({...generation,submission:undefined},undefined,now);
 localStorage.setItem('pending-request-uuid','same');const before={...localStorage};
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('full','QuotaExceededError');});
 expect(rememberGenerationSubmission(id,generation.expiresAt,receipt,now)).toBe(false);
 expect({...localStorage}).toEqual(before);
});

it.each(['version','receipt'])('reclaims expired history before one identical %s receipt retry',mode=>{
 const other='b'.repeat(64),staleKey=HISTORY_V2_PREFIX+other;
 rememberGenerationVersion({...generation,submission:undefined},undefined,now);
 localStorage.setItem('pending-request-uuid','same');
 localStorage.setItem(staleKey,JSON.stringify({version:2,generationId:other,familyId:other,savedAt:now-10*day,expiresAt:now-9*day}));
 const original=Storage.prototype.setItem;let attempts=0;
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
  if(key.startsWith(SUBMISSION_HISTORY_PREFIX)){attempts++;if(localStorage.getItem(staleKey))throw new DOMException('full','QuotaExceededError');}
  original.call(this,key,value);
 });
 const saved=mode==='version'?rememberGenerationVersion(generation,undefined,now+1):rememberGenerationSubmission(id,generation.expiresAt,receipt,now+1);
 expect(saved).toBe(true);expect(attempts).toBe(2);expect(localStorage.getItem(staleKey)).toBeNull();
 expect(readGenerationHistory(now+1).entries[0].submission).toEqual(receipt);
 expect(localStorage.getItem('pending-request-uuid')).toBe('same');
 expect(readGenerationHistory(now+1).entries[0].expiresAt).toBe(now+day);
});

it('stops after one direct receipt quota retry and preserves recovery settings',()=>{
 localStorage.setItem('pending-request-uuid','unchanged');let writes=0;
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{writes++;throw new DOMException('full','QuotaExceededError');});
 expect(rememberGenerationSubmission(id,generation.expiresAt,receipt,now)).toBe(false);
 expect(writes).toBe(2);expect(localStorage.getItem('pending-request-uuid')).toBe('unchanged');
});
