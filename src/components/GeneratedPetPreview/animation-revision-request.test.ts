import {webcrypto} from "node:crypto";
import {afterEach,expect,it,vi} from "vitest";
import * as requests from "./animation-revision-request";
afterEach(()=>vi.unstubAllGlobals());
it("pins UUID and canonical content for 48h without storing text",async()=>{
  vi.stubGlobal("crypto",webcrypto);
  const values=new Map<string,string>(); const storage={getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>{values.set(k,v);},removeItem:(k:string)=>{values.delete(k);}};
  const brief={states:["waving","idle"],prompt:"  Private\r\ncorrection  ",sourceMetadataRevision:2};
  const first=await requests.prepareAnimationRevision(storage,"a".repeat(64),brief,1000);
  expect(first.isNew).toBe(true);expect([...values.values()].join()).not.toContain("Private");
  const repeat=await requests.prepareAnimationRevision(storage,"a".repeat(64),{...brief,states:["idle","waving"]},1000+25*3600000);
  expect(repeat.input.requestId).toBe(first.input.requestId);expect(repeat.isNew).toBe(false);
  await expect(requests.prepareAnimationRevision(storage,"a".repeat(64),{...brief,prompt:"Other"},2000)).rejects.toThrow("animation_revision_replay_mismatch");
  repeat.clear();const next=await requests.prepareAnimationRevision(storage,"a".repeat(64),brief,3000);expect(next.input.requestId).not.toBe(first.input.requestId);
  first.clear();expect(requests.readAnimationRevision(storage,"a".repeat(64),3000)?.requestId).toBe(next.input.requestId);
});
