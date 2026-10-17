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

it("uploads image-only, retains it on retry, supports replacing/removing and clears it after acceptance", async () => {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:synthetic-reference");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  try {
    act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase /></ThemeProvider>));
    function choose(name: string) {
      const file = new File(["synthetic-" + name], name, {type: "image/png"});
      Object.defineProperty(file, "arrayBuffer", {value: async () => new TextEncoder().encode(name).buffer});
      const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
      Object.defineProperty(input, "files", {configurable: true, value: [file]});
      act(() => input.dispatchEvent(new Event("change", {bubbles: true})));
    }
    choose("first.png");
    expect(element.textContent).toContain("What should change?"); expect(element.querySelector("textarea")!.getAttribute("aria-required")).toBe("false");
    expect(element.querySelector('img')?.getAttribute("src")).toBe("blob:synthetic-reference");
    fetchMock.mockRejectedValueOnce(Error("lost response")); await submit();
    const first = fetchMock.mock.calls[0][1].body as FormData;
    expect(first.get("prompt")).toBe(""); expect((first.get("referenceImage") as File).name).toBe("first.png");
    fetchMock.mockRejectedValueOnce(Error("still offline")); await submit();
    expect((fetchMock.mock.calls[1][1].body as FormData).get("requestId")).toBe(first.get("requestId"));
    choose("second.png"); expect(revoke).toHaveBeenCalled();
    act(() => [...element.querySelectorAll("button")].find(button => button.textContent === "Remove image")!.click());
    expect(element.querySelector("img")).toBeNull(); expect(element.textContent).toContain("Describe your pet");
    await submit(); expect(fetchMock).toHaveBeenCalledTimes(2);
    choose("second.png");
    fetchMock.mockResolvedValueOnce({ok: true, json: async () => ({generation: {generationId: "d".repeat(64), expiresAt: new Date(Date.now() + 86400000).toISOString()}})});
    await submit(); expect(element.querySelector("img")).toBeNull(); expect(fetchMock.mock.calls[2][1].headers).toBeUndefined();
    expect(JSON.stringify(sessionStorage)).not.toContain("second.png"); expect(JSON.stringify(localStorage)).not.toContain("second.png");
  } finally {create.mockRestore(); revoke.mockRestore();}
});

it("does not silently submit a previous reference after a rejected replacement", async () => {
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:old-reference");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  try {
    act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase /></ThemeProvider>));
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    const first = new File(["synthetic"], "first.png", {type: "image/png"});
    Object.defineProperty(first, "arrayBuffer", {value: async () => new TextEncoder().encode("synthetic").buffer});
    Object.defineProperty(input, "files", {configurable: true, value: [first]});
    act(() => input.dispatchEvent(new Event("change", {bubbles: true})));
    const invalid = new File(["not-an-image"], "replacement.svg", {type: "image/svg+xml"});
    Object.defineProperty(input, "files", {configurable: true, value: [invalid]});
    act(() => input.dispatchEvent(new Event("change", {bubbles: true})));
    await submit();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(element.querySelector("img")).toBeNull();
    expect(element.textContent).not.toContain("Selected: first.png");
    prompt("Keep the red sweater");
    await submit(); expect(fetchMock).not.toHaveBeenCalled();
    act(() => [...element.querySelectorAll("button")].find(button => button.textContent === "Remove image")!.click());
    fetchMock.mockRejectedValueOnce(Error("synthetic offline"));
    await submit(); expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).prompt).toBe("Keep the red sweater");
  } finally {create.mockRestore(); revoke.mockRestore();}
});
