// @vitest-environment jsdom
import "./browser.test-utils";
import {act} from "react";
import {createRoot} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterAll,expect,it,vi} from "vitest";
vi.hoisted(()=>{
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_BASE_PATH","/codex-pets");
  vi.stubEnv("__NEXT_ROUTER_BASEPATH","/codex-pets");
});
vi.mock("next/navigation",()=>({useRouter:()=>({push:vi.fn()})}));
import {MyGenerations} from "./MyGenerations";
import {GeneratedPetPreview} from "@/components/GeneratedPetPreview/GeneratedPetPreview";
import {rememberGeneration} from "@/lib/pets/generation/history";

afterAll(()=>vi.unstubAllEnvs());
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false})) as typeof window.matchMedia;
it("keeps one base path on history and result navigation",async()=>{
  const id="c".repeat(64),expiresAt=new Date(Date.now()+86400000).toISOString();
  localStorage.clear();rememberGeneration(id,expiresAt);
  vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,status:200,json:async()=>({generation:{generationId:id,status:"failed",expiresAt,progress:{completedSteps:3,totalSteps:12},canContinue:true}})})));
  const element=document.createElement("div");document.body.append(element);const root=createRoot(element);
  try{
    await act(async()=>root.render(<ThemeProvider theme="light"><MyGenerations/><GeneratedPetPreview generationId={id}/></ThemeProvider>));
    const open=[...element.querySelectorAll("a")].find(a=>a.textContent==="Open generation");
    const back=[...element.querySelectorAll("a")].find(a=>a.textContent==="My generations");
    expect(open?.getAttribute("href")).toBe("/codex-pets/generated/"+id);
    expect(open?.getAttribute("role")).toBeNull();
    expect(back?.getAttribute("href")).toBe("/codex-pets/my-generations");
  }finally{
    await act(async()=>root.unmount());element.remove();localStorage.clear();vi.unstubAllGlobals();
  }
});
