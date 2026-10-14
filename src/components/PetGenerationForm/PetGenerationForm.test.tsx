// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ThemeProvider } from "@gravity-ui/uikit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readGenerationHistory } from "@/lib/pets/generation/history";
import { PetGenerationForm } from "./PetGenerationForm";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?:boolean }).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia ??= ((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false})) as typeof window.matchMedia;
let root:Root;let element:HTMLDivElement; const fetchMock=vi.fn();
beforeEach(()=>{element=document.createElement("div");document.body.append(element);root=createRoot(element);sessionStorage.clear();localStorage.clear();vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.unstubAllGlobals();});
function prompt(value:string) {
  const input=element.querySelector("textarea")!;
  act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});
}
async function submit(){await act(async()=>{element.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,20));});}
describe("generation form payment guard",()=>{
  it.each([['ip', 'IP address'], ['global', 'whole service']])("identifies the %s daily quota without showing private provider data", async (limitScope, expected) => {
    act(()=>root.render(<ThemeProvider theme="light"><PetGenerationForm enabled/></ThemeProvider>));prompt("Synthetic fox");
    fetchMock.mockResolvedValueOnce({ok:false,json:async()=>({code:"rate_limited",limitScope,message:"private-untrusted-text"})});await submit();
    expect(element.textContent).toContain(expected);expect(element.textContent).not.toContain("private-untrusted-text");
  });
  it("does not submit empty/disabled forms and advertises its limits",async()=>{
    act(()=>root.render(<ThemeProvider theme="light"><PetGenerationForm enabled={false}/></ThemeProvider>));
    await submit();expect(fetchMock).not.toHaveBeenCalled();expect(element.textContent).toContain("30 minutes");expect(element.querySelector("textarea")?.disabled).toBe(true);
    expect(element.textContent).toContain("Experimental feature");
    expect(element.textContent).toContain("animations and gaze directions may contain visual errors");
  });
  it("reuses the same request after a network error and exposes only the accepted private link",async()=>{
    act(()=>root.render(<ThemeProvider theme="light"><PetGenerationForm enabled/></ThemeProvider>));prompt("A private test fox");
    fetchMock.mockRejectedValueOnce(new Error("network"));await submit();
    const first=JSON.parse(fetchMock.mock.calls[0][1].body);
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({generation:{generationId:"a".repeat(64),status:"queued"}})});
    await submit();expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(first.requestId);
    expect(element.querySelector<HTMLAnchorElement>("a")?.getAttribute("href")).toBe("/generated/"+"a".repeat(64));
    await submit();expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(element.textContent).not.toContain("private test fox");
  });
});

it("remembers an accepted task without saving its description",async()=>{
 act(()=>root.render(<ThemeProvider theme="light"><PetGenerationForm enabled/></ThemeProvider>));prompt("Do not persist this prompt");
 fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({generation:{generationId:"b".repeat(64),status:"queued",expiresAt:new Date(Date.now()+86400000).toISOString()}})});await submit();
 expect(readGenerationHistory().entries.map(x=>x.generationId)).toEqual(["b".repeat(64)]);expect(JSON.stringify(localStorage)).not.toContain("Do not persist");
});

it("keeps the accepted link and never offers a paid retry when history storage is blocked",async()=>{
 const storage=vi.spyOn(window,"localStorage","get").mockImplementation(()=>{throw Error("blocked")});
 try{
  act(()=>root.render(<ThemeProvider theme="light"><PetGenerationForm enabled/></ThemeProvider>));prompt("Synthetic private description");
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({generation:{generationId:"c".repeat(64),expiresAt:new Date(Date.now()+86400000).toISOString()}})});await submit();
  expect(element.querySelector('a[href="/generated/'+"c".repeat(64)+'"]')).not.toBeNull();expect(element.textContent).toContain("was accepted");expect(element.textContent).toContain("could not save its link");await submit();expect(fetchMock).toHaveBeenCalledTimes(1);
 }finally{storage.mockRestore();}
});
