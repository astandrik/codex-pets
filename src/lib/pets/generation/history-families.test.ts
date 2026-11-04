// @vitest-environment jsdom
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {HISTORY_PREFIX,HISTORY_V2_PREFIX,HISTORY_FACT_PREFIX,readGenerationHistory,rememberGeneration,rememberGenerationVersion,pruneGenerationHistory,parseHistoryGeneration} from './history';
import {groupGenerationVersions} from './history-families';
const now=Date.parse('2026-11-04T10:00:00Z'),day=86400000;
const id=(n:number)=>n.toString(16).padStart(64,'0');
const gen=(n:number,t=0)=>({generationId:id(n),expiresAt:new Date(now+day).toISOString(),createdAt:new Date(now+t).toISOString()});
beforeEach(()=>localStorage.clear());
describe('generation families',()=>{
 it('keeps A → B → C together, and a new generation separate',()=>{
  rememberGenerationVersion(gen(1),undefined,now);
  rememberGenerationVersion(gen(2,1),{generationId:id(1),kind:'base-refinement'},now+1);
  rememberGenerationVersion(gen(3,2),{generationId:id(2),kind:'continuation'},now+2);
  rememberGenerationVersion(gen(4,3),undefined,now+3);
  const families=groupGenerationVersions(readGenerationHistory(now+4).entries);
  expect(families.map(f=>f.versions.map(v=>v.generationId))).toEqual([[id(4)],[id(3),id(2),id(1)]]);
 });
 it('does not promote reopened old versions or replayed receipts',()=>{
  rememberGenerationVersion(gen(1),undefined,now);
  rememberGenerationVersion(gen(2,1),{generationId:id(1),kind:'base-retry'},now+1);
  rememberGeneration(id(1),gen(1).expiresAt,now+20);
  rememberGenerationVersion(gen(2,1),{generationId:id(1),kind:'base-retry'},now+30);
  const f=groupGenerationVersions(readGenerationHistory(now+40).entries)[0];
  expect(f.versions).toHaveLength(2);expect(f.versions[0].generationId).toBe(id(2));
  expect(f.versions[1].savedAt).toBe(now);
 });
 it('keeps 50 families including all retained versions of a family',()=>{
  for(let n=1;n<=50;n++)rememberGenerationVersion(gen(n,n),undefined,now+n);
  for(let n=51;n<=110;n++)rememberGenerationVersion(gen(n,n),{generationId:id(50),kind:'continuation'},now+n);
  expect(readGenerationHistory(now+111).entries).toHaveLength(110);
  rememberGenerationVersion(gen(111,111),undefined,now+111);
  const groups=groupGenerationVersions(readGenerationHistory(now+112).entries);
  expect(groups).toHaveLength(50);expect(groups.some(g=>g.familyId===id(1))).toBe(false);
  expect(groups.find(g=>g.familyId===id(50))?.versions).toHaveLength(61);
 });
 it('merges old writes without losing v2 lineage and imports known API links',()=>{
  rememberGenerationVersion(gen(1),undefined,now);
  rememberGenerationVersion(gen(2,1),{generationId:id(1),kind:'animation-revision'},now+1);
  localStorage.setItem(HISTORY_PREFIX+id(2),JSON.stringify({generationId:id(2),savedAt:now+50,expiresAt:now+day}));
  const entry=readGenerationHistory(now+60).entries.find(x=>x.generationId===id(2));
  expect(entry).toMatchObject({parentGenerationId:id(1),familyId:id(1),savedAt:now+1});
  const parsed=parseHistoryGeneration({...gen(3,2),status:'queued',progress:{completedSteps:0,totalSteps:12},baseRetrySourceId:id(2)},id(3))!;
  rememberGenerationVersion(parsed,undefined,now+2);
  expect(groupGenerationVersions(readGenerationHistory(now+60).entries)).toHaveLength(1);
 });
 it('retains root identity when an expired intermediate record is pruned',()=>{
  const old=(n:number)=>({...gen(n),expiresAt:new Date(now-7*day+100).toISOString(),createdAt:new Date(now-8*day+100).toISOString()});
  rememberGenerationVersion(old(1),undefined,now-8*day+100);
  rememberGenerationVersion(old(2),{generationId:id(1),kind:'base-refinement'},now-8*day+101);
  rememberGenerationVersion(gen(3),{generationId:id(2),kind:'continuation'},now);
  pruneGenerationHistory(now+200);
  expect(readGenerationHistory(now+200).entries).toMatchObject([{generationId:id(3),familyId:id(1)}]);
 });
 it('does not prune old history or touch UUID recovery if the save fails',()=>{
  rememberGenerationVersion(gen(1),undefined,now);localStorage.setItem('pending-uuid','keep');
  const before={...localStorage};vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota')});
  expect(rememberGenerationVersion(gen(2),{generationId:id(1),kind:'continuation'},now)).toBe(false);
  expect({...localStorage}).toEqual(before);vi.restoreAllMocks();
 });
 it('rejects cyclic edges and leaves the records independently accessible',()=>{
  rememberGenerationVersion(gen(1),{generationId:id(2),kind:'continuation'},now);
  rememberGenerationVersion(gen(2),{generationId:id(1),kind:'continuation'},now);
  const entries=readGenerationHistory(now).entries;
  expect(entries).toHaveLength(2);expect(groupGenerationVersions(entries)).toHaveLength(2);
 });
});

it('does not rewrite unchanged entries when another window observes a status',()=>{
 rememberGenerationVersion(gen(1),undefined,now);rememberGenerationVersion(gen(2,1),{generationId:id(1),kind:'continuation'},now+1);
 const write=vi.spyOn(Storage.prototype,'setItem');
 rememberGenerationVersion(gen(2,1),undefined,now+2);pruneGenerationHistory(now+3);
 expect(write).not.toHaveBeenCalled();vi.restoreAllMocks();
});

it('preserves creation time and the first confirmed parent on conflicting later data',()=>{
 rememberGenerationVersion(gen(1),undefined,now);
 rememberGenerationVersion(gen(2,1),{generationId:id(1),kind:'continuation'},now+1);
 rememberGenerationVersion(gen(2,20),{generationId:id(4),kind:'base-refinement'},now+30);
 expect(readGenerationHistory(now+31).entries.find(v=>v.generationId===id(2))).toMatchObject({createdAt:now+1,parentGenerationId:id(1)});
});
it('orders parallel descendants by creation rather than completion or receipt arrival',()=>{
 rememberGenerationVersion(gen(1),undefined,now);
 rememberGenerationVersion(gen(3,3),{generationId:id(1),kind:'continuation'},now+4);
 rememberGenerationVersion(gen(2,2),{generationId:id(1),kind:'continuation'},now+5);
 expect(groupGenerationVersions(readGenerationHistory(now+6).entries)[0].versions.map(v=>v.generationId)).toEqual([id(3),id(2),id(1)]);
});

function reviewStorage(){
 const values=new Map<string,string>();
 return {values,get length(){return values.size;},key:(i:number)=>[...values.keys()][i]??null,getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
}
it('does not evict an available parent before resolving an overflow legacy child',()=>{
 const storage=reviewStorage();for(let n=1;n<=50;n++)rememberGenerationVersion(gen(n,n),undefined,now+n,storage);
 storage.setItem(HISTORY_PREFIX+id(51),JSON.stringify({generationId:id(51),savedAt:now+1000,expiresAt:now+day}));
 pruneGenerationHistory(now+1001,storage);
 rememberGenerationVersion({...gen(51,1000),continuation:{sourceGenerationId:id(1),mode:'regenerate'}},undefined,now+1002,storage);
 expect(groupGenerationVersions(readGenerationHistory(now+1003,storage).entries).find(f=>f.familyId===id(1))?.versions.map(v=>v.generationId)).toEqual([id(51),id(1)]);
});
it('preserves a parent learned by another tab while cleanup has an older snapshot',()=>{
 const storage=reviewStorage();rememberGenerationVersion(gen(1),undefined,now+1,storage);rememberGenerationVersion(gen(2),undefined,now+2,storage);
 const get=storage.getItem;let inserted=false;
 storage.getItem=key=>{const value=get(key);if(!inserted&&key.endsWith(id(2))){inserted=true;rememberGenerationVersion(gen(2),{generationId:id(1),kind:'base-refinement'},now+3,storage);}return value;};
 pruneGenerationHistory(now+4,storage);
 expect(inserted).toBe(true);
 expect(groupGenerationVersions(readGenerationHistory(now+5,storage).entries)).toHaveLength(1);
});
it('updates unchanged statuses with linear storage work',()=>{
 const storage=reviewStorage();for(let n=1;n<=200;n++)rememberGenerationVersion(gen(n,n),n===1?undefined:{generationId:id(1),kind:'continuation'},now+n,storage);
 const get=storage.getItem;let reads=0;storage.getItem=key=>{reads++;return get(key);};
 for(let n=1;n<=200;n++)rememberGenerationVersion(gen(n,n),undefined,now+201,storage);
 expect(reads).toBeLessThan(200*20);
});

it('does not expose orphan metadata after a failed record save, and recovers idempotently',()=>{
 const storage=reviewStorage(),write=storage.setItem;
 storage.setItem=(key,value)=>{if(key.startsWith(HISTORY_V2_PREFIX))throw Error('quota');write(key,value);};
 expect(rememberGenerationVersion(gen(2),{generationId:id(1),kind:'base-refinement'},now+2,storage)).toBe(false);
 expect(readGenerationHistory(now+3,storage).entries).toHaveLength(0);
 storage.setItem=write;
 expect(rememberGenerationVersion(gen(2),{generationId:id(1),kind:'base-refinement'},now+4,storage)).toBe(true);
 const count=storage.length;
 rememberGenerationVersion(gen(2),{generationId:id(1),kind:'base-refinement'},now+5,storage);
 expect(storage.length).toBe(count);
 expect(readGenerationHistory(now+6,storage).entries).toMatchObject([{generationId:id(2),parentGenerationId:id(1)}]);
});
it('expires lineage metadata after its last retained descendant, without touching recovery',()=>{
 const storage=reviewStorage();storage.setItem('pets-continuation-request','same UUID');
 rememberGenerationVersion(gen(1),undefined,now+1,storage);
 rememberGenerationVersion(gen(2),{generationId:id(1),kind:'base-refinement'},now+2,storage);
 expect([...storage.values.keys()].some(key=>key.startsWith(HISTORY_FACT_PREFIX))).toBe(true);
 pruneGenerationHistory(now+8*day+1,storage);
 expect([...storage.values.keys()]).toEqual(['pets-continuation-request']);
});
