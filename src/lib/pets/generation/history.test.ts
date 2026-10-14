// @vitest-environment jsdom
import {beforeEach, describe, expect, it, vi} from "vitest";
import {HISTORY_PREFIX, readGenerationHistory, rememberGeneration, parseHistoryGeneration} from "./history";
const now=Date.parse("2026-10-12T12:00:00Z"), id="a".repeat(64), expires=new Date(now+86400000).toISOString();
beforeEach(()=>localStorage.clear());
describe("private browser generation history",()=>{
 it("persists only private ID and timestamps, deduplicates and survives a new read",()=>{
  expect(rememberGeneration(id,expires,now)).toBe(true);
  expect(rememberGeneration(id,expires,now+1000)).toBe(true);
  expect(readGenerationHistory(now+2000)).toEqual({available:true,entries:[{generationId:id,savedAt:now,expiresAt:Date.parse(expires)}]});
  expect(Object.keys(JSON.parse(localStorage.getItem(HISTORY_PREFIX+id)!)).sort()).toEqual(["expiresAt","generationId","savedAt"]);
 });
 it("keeps independent tab additions instead of overwriting an entire list",()=>{
  rememberGeneration(id,expires,now);rememberGeneration("b".repeat(64),expires,now+1);
  expect(readGenerationHistory(now+2).entries.map(x=>x.generationId)).toEqual(["b".repeat(64),id]);
  expect(localStorage.length).toBe(2);
 });
 it("rejects paths, foreign URLs, invalid expiry and mismatched or oversized stored data",()=>{
  for(const bad of ["javascript:alert(1)","../other",`https://evil.example/${id}`,"A".repeat(64)])expect(rememberGeneration(bad,expires,now)).toBe(false);
  expect(rememberGeneration(id,"invalid",now)).toBe(false);
  localStorage.setItem(HISTORY_PREFIX+id,JSON.stringify({generationId:"b".repeat(64),savedAt:now,expiresAt:now+1}));
  localStorage.setItem(HISTORY_PREFIX+"c".repeat(64),"x".repeat(2000));
  expect(readGenerationHistory(now).entries).toEqual([]);
 });
 it("retains an expired status for seven days, then purges only owned records",()=>{
  rememberGeneration(id,expires,now);localStorage.setItem("unrelated","keep");
  expect(readGenerationHistory(now+2*86400000).entries).toHaveLength(1);
  expect(readGenerationHistory(now+8*86400000).entries).toEqual([]);
  expect(localStorage.getItem("unrelated")).toBe("keep");
 });
 it("bounds history to the fifty most recently saved entries",()=>{
  for(let i=0;i<51;i++)rememberGeneration(i.toString(16).padStart(64,"0"),expires,now+i);
  const entries=readGenerationHistory(now+52).entries;expect(entries).toHaveLength(50);expect(entries[0].savedAt).toBe(now+50);expect(entries.at(-1)?.savedAt).toBe(now+1);
 });
 it("reports blocked browser storage without throwing or starting anything",()=>{
  const storage={get length():number{throw Error("blocked")},key:vi.fn(),getItem:vi.fn(),setItem:vi.fn(()=>{throw Error("full")}),removeItem:vi.fn()};
  expect(readGenerationHistory(now,storage)).toEqual({available:false,entries:[]});expect(rememberGeneration(id,expires,now,storage)).toBe(false);
 });
 it("validates the exact requested capability and ignores server-supplied URLs or private fields",()=>{
  const value={generationId:id,status:"completed",expiresAt:expires,progress:{completedSteps:12,totalSteps:12},pet:{displayName:"Synthetic",zipUrl:"https://evil.example"},prompt:"private"};
  expect(parseHistoryGeneration(value,id)).toEqual({generationId:id,status:"completed",expiresAt:expires,progress:{completedSteps:12,totalSteps:12},pet:{displayName:"Synthetic"}});
  expect(parseHistoryGeneration({...value,generationId:"b".repeat(64)},id)).toBeNull();
  expect(parseHistoryGeneration({...value,progress:{completedSteps:13,totalSteps:12}},id)).toBeNull();
 });
});
