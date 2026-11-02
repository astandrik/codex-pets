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
    await submit();expect(fetchMock).not.toHaveBeenCalled();expect(element.querySelector("textarea")?.disabled).toBe(true);
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
    act(() => [...element.querySelectorAll("button")].find(button => (button.getAttribute("aria-label") || button.textContent) === "Remove image" || button.textContent === "Use description only")!.click());
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
    act(() => [...element.querySelectorAll("button")].find(button => (button.getAttribute("aria-label") || button.textContent) === "Remove image" || button.textContent === "Use description only")!.click());
    fetchMock.mockRejectedValueOnce(Error("synthetic offline"));
    await submit(); expect(fetchMock).toHaveBeenCalledOnce();
    expect((fetchMock.mock.calls[0][1].body as FormData).get("prompt")).toBe("Keep the red sweater");
  } finally {create.mockRestore(); revoke.mockRestore();}
});


function click(label: string) {
  const button = [...element.querySelectorAll('button')].find(item => item.textContent?.includes(label));
  expect(button, label).toBeDefined();
  act(() => button!.click());
}
function name(value: string) {
  const input = element.querySelector<HTMLInputElement>('#pet-generation-name')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', {bubbles: true}));
  });
}
it('keeps one mounted name field and draft through collapse, theme, limits and resize without requests', async () => {
  const uuid = vi.spyOn(crypto, 'randomUUID');
  const render = (theme: 'light' | 'dark') => act(() => root.render(<ThemeProvider theme={theme}><PetGenerationForm enabled reviewBase /></ThemeProvider>));
  render('light'); prompt('Keep my draft'); click('Add a name'); name('Unsent name');
  const input = element.querySelector('#pet-generation-name');
  click('Pet name'); click('Limits & privacy');
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true})));
  render('dark'); act(() => window.dispatchEvent(new Event('resize'))); click('Add a name');
  expect(element.querySelector('#pet-generation-name')).toBe(input);
  expect((input as HTMLInputElement).value).toBe('Unsent name');
  expect(element.querySelector('textarea')!.value).toBe('Keep my draft');
  expect(element.querySelectorAll('form')).toHaveLength(1);
  expect(element.querySelectorAll('input[type="file"]')).toHaveLength(1);
  expect(element.querySelector('textarea')!.maxLength).toBe(2000);
  expect((input as HTMLInputElement).maxLength).toBe(80);
  expect(fetchMock).not.toHaveBeenCalled(); expect(uuid).not.toHaveBeenCalled(); expect(sessionStorage.length).toBe(0);
  uuid.mockRestore();
});
it('finishes name with Enter without submitting and leaves IME composition alone', () => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled /></ThemeProvider>));
  prompt('Fox'); click('Add a name');
  const input = element.querySelector<HTMLInputElement>('#pet-generation-name')!;
  input.focus();
  const composing = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true, isComposing: true});
  act(() => input.dispatchEvent(composing)); expect(composing.defaultPrevented).toBe(false); expect(document.activeElement).toBe(input);
  const enter = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
  act(() => input.dispatchEvent(enter)); expect(enter.defaultPrevented).toBe(true); expect(document.activeElement).not.toBe(input);
  const areaEnter = new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true});
  act(() => element.querySelector('textarea')!.dispatchEvent(areaEnter)); expect(areaEnter.defaultPrevented).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('labels a recovery retry as unchanged only until the draft has been edited', async () => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled /></ThemeProvider>)); prompt('Fox');
  fetchMock.mockRejectedValueOnce(Error('lost')); await submit();
  expect(element.textContent).toContain('Retry unchanged request');
  const first = JSON.parse(fetchMock.mock.calls[0][1].body);
  click('Add a name'); name('New name');
  expect(element.textContent).not.toContain('Retry unchanged request');
  expect(element.textContent).toContain('may create a new task');
  fetchMock.mockRejectedValueOnce(Error('lost again')); await submit();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).not.toBe(first.requestId);
});
it('guards a delayed double submission with one operation', async () => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled /></ThemeProvider>)); prompt('Fox');
  let resolve!: (value: unknown) => void;
  fetchMock.mockImplementation(() => new Promise(r => {resolve = r;}));
  await submit(); await submit(); expect(fetchMock).toHaveBeenCalledOnce();
  expect(element.querySelector('textarea')!.disabled).toBe(true);
  await act(async () => {resolve({ok:true,json:async()=>({generation:{generationId:'e'.repeat(64),expiresAt:'2026-10-28T09:00:00.000Z'}})});});
  expect(element.querySelector('time')?.dateTime).toBe('2026-10-28T09:00:00.000Z');
});
it('keeps malformed responses recoverable without leaking values or creating another identity', async () => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled /></ThemeProvider>)); prompt('Fox');
  fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({generation:{generationId:'private-invalid'}})}); await submit();
  const first = JSON.parse(fetchMock.mock.calls[0][1].body).requestId;
  expect(element.textContent).toContain('Retry unchanged request'); expect(element.textContent).not.toContain('private-invalid');
  fetchMock.mockRejectedValueOnce(Error('still offline')); await submit();
  expect(JSON.parse(fetchMock.mock.calls[1][1].body).requestId).toBe(first);
});
it('never sends when session storage is unavailable and retains input', async () => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled /></ThemeProvider>)); prompt('Keep this');
  const blocked = vi.spyOn(window,'sessionStorage','get').mockImplementation(()=>{throw Error('blocked');});
  try {await submit(); expect(fetchMock).not.toHaveBeenCalled(); expect(element.querySelector('textarea')!.value).toBe('Keep this');} finally {blocked.mockRestore();}
});
it.each(['budget_exhausted','queue_full','generation_paused','generation_disabled','request_id_conflict','generation_expired','generation_review_disabled','unknown'])('keeps safe %s errors and the draft', async code => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase /></ThemeProvider>)); prompt('Keep draft');
  fetchMock.mockResolvedValueOnce({ok:false,json:async()=>({code,message:'private-provider-error'})}); await submit();
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
  expect(element.textContent).not.toContain('private-provider-error'); expect(element.querySelector('textarea')!.value).toBe('Keep draft');
});
it('ignores whitespace and can clear an invalid image without submitting', async () => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase /></ThemeProvider>)); prompt('  '); await submit();
  const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input,'files',{configurable:true,value:[new File(['x'],'bad.svg',{type:'image/svg+xml'})]});
  act(()=>input.dispatchEvent(new Event('change',{bubbles:true}))); prompt('Fox'); click('Use description only');
  expect(fetchMock).not.toHaveBeenCalled(); expect(element.querySelector('[role="alert"]')).toBeNull();
});

it.each([
 ['empty',new File([],'empty.png',{type:'image/png'})],
 ['mime',new File(['x'],'bad.svg',{type:'image/svg+xml'})],
 ['oversized',new File([new Uint8Array(5*1024*1024+1)],'big.png',{type:'image/png'})],
])('rejects %s references without requests or recovery writes', async (_label,file)=>{
 act(()=>root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase/></ThemeProvider>));prompt('Keep this text');
 const input=element.querySelector<HTMLInputElement>('input[type="file"]')!;
 Object.defineProperty(input,'files',{configurable:true,value:[file]});act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 await submit();expect(fetchMock).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);expect(element.querySelector('textarea')!.value).toBe('Keep this text');expect(element.querySelector('[role="alert"]')).not.toBeNull();
});
it('rejects multiple references and accepts the exact size boundary without preparing a request',()=>{
 const create=vi.spyOn(URL,'createObjectURL').mockReturnValue('blob:boundary');const revoke=vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
 try {
  act(()=>root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase/></ThemeProvider>));
  const input=element.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input,'files',{configurable:true,value:[new File(['a'],'a.png',{type:'image/png'}),new File(['b'],'b.png',{type:'image/png'})]});act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
  Object.defineProperty(input,'files',{configurable:true,value:[new File([new Uint8Array(5*1024*1024)],'valid.png',{type:'image/png'})]});act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));
  expect(element.querySelector('[role="alert"]')).toBeNull();expect(element.querySelector('img')).not.toBeNull();expect(fetchMock).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(0);
 } finally {create.mockRestore();revoke.mockRestore();}
});

it('keeps the changed-request warning after clearing an invalid replacement during recovery',async()=>{
 act(()=>root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase/></ThemeProvider>));prompt('Fox');
 fetchMock.mockRejectedValueOnce(Error('lost'));await submit();
 const input=element.querySelector<HTMLInputElement>('input[type="file"]')!;
 Object.defineProperty(input,'files',{configurable:true,value:[new File(['bad'],'bad.svg',{type:'image/svg+xml'})]});act(()=>input.dispatchEvent(new Event('change',{bubbles:true})));
 click('Use description only');expect(element.textContent).toContain('may create a new task');expect(element.textContent).not.toContain('Retry unchanged request');expect(fetchMock).toHaveBeenCalledOnce();
});


it.each([500, 502, 503, 504])('keeps uncertainty after a lost response followed by HTTP %s', async status => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase /></ThemeProvider>));
  prompt('Original fox');
  fetchMock.mockRejectedValueOnce(Error('lost response'));
  await submit();
  const firstId = (fetchMock.mock.calls[0][1].body as FormData).get('requestId');
  fetchMock.mockResolvedValueOnce({ok: false, status, json: async () => ({code: 'generation_unavailable', message: 'untrusted server detail'})});
  await submit();
  expect((fetchMock.mock.calls[1][1].body as FormData).get('requestId')).toBe(firstId);
  expect(element.textContent).toContain('Retry unchanged request');
  expect(element.textContent).not.toContain('untrusted server detail');
  prompt('Edited fox');
  expect(element.textContent).toContain('may create a new task');
  expect(element.textContent).toContain('Submit changed request');
  expect(element.querySelectorAll('button[type="submit"]')).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  fetchMock.mockRejectedValueOnce(Error('still unavailable'));
  await submit();
  expect((fetchMock.mock.calls[2][1].body as FormData).get('requestId')).not.toBe(firstId);
});
it('can recover unchanged after a server error and removes retry actions on acceptance', async () => {
  act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled /></ThemeProvider>));
  prompt('Original fox');
  fetchMock.mockRejectedValueOnce(Error('lost')); await submit();
  const id = JSON.parse(fetchMock.mock.calls[0][1].body).requestId;
  fetchMock.mockResolvedValueOnce({ok: false, status: 503, json: async () => ({code: 'generation_unavailable'})}); await submit();
  expect(element.textContent).toContain('Retry unchanged request');
  fetchMock.mockResolvedValueOnce({ok: true, json: async () => ({generation: {generationId: 'f'.repeat(64), expiresAt: new Date(Date.now() + 86400000).toISOString()}})}); await submit();
  expect(JSON.parse(fetchMock.mock.calls[2][1].body).requestId).toBe(id);
  expect(element.querySelector('a[href="/generated/' + 'f'.repeat(64) + '"]')).not.toBeNull();
  expect(element.querySelector('button[type="submit"]')).toBeNull();
  expect(element.textContent).not.toContain('Retry unchanged request');
});
it('uses large accessible reference actions without submitting when they are used', () => {
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reference-actions');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  try {
    act(() => root.render(<ThemeProvider theme="light"><PetGenerationForm enabled reviewBase /></ThemeProvider>));
    const input = element.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', {configurable: true, value: [new File(['reference'], 'ref.png', {type: 'image/png'})]});
    act(() => input.dispatchEvent(new Event('change', {bubbles: true})));
    const buttons = [...element.querySelectorAll<HTMLButtonElement>('.pet-generation-form__file-actions button')];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.classList.contains('g-button_size_xl')).toBe(true);
    const remove = buttons.find(button => (button.getAttribute('aria-label') || button.textContent) === 'Remove image')!;
    act(() => remove.click());
    expect(element.querySelector('img')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {create.mockRestore(); revoke.mockRestore();}
});

it.each(["dark", "light"] as const)("shows queue capacity and the original storage deadline in %s without submitting", async theme => {
  act(() => root.render(<ThemeProvider theme={theme}><PetGenerationForm enabled reviewBase queueLimit={7}/></ThemeProvider>));
  prompt("Keep this draft");
  const show = [...element.querySelectorAll("button")].find(button => button.textContent === "Limits & privacy")!;
  act(() => show.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Up to 7 tasks may wait");
  expect(dialog.textContent).toContain("until they start or their 24-hour lifetime expires");
  expect(dialog.textContent).not.toContain("60 minutes");
  expect(dialog.textContent).toContain("24 hours from task acceptance");
  act(() => [...dialog.querySelectorAll("button")].find(button => button.textContent === "Got it")!.click());
  expect(element.querySelector("textarea")?.value).toBe("Keep this draft");
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each(["dark", "light"] as const)("keeps unavailable queue information and the draft in %s without passive requests", async theme => {
  act(() => root.render(<ThemeProvider theme={theme}><PetGenerationForm enabled queueLimit={null}/></ThemeProvider>));
  prompt("Keep recovery details");
  expect(element.textContent).toContain("New requests are temporarily unavailable");
  expect([...element.querySelectorAll("button")].some(button => button.textContent === "Check existing request")).toBe(true);
  act(() => [...element.querySelectorAll("button")].find(button => button.textContent === "Limits & privacy")!.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Queue capacity is temporarily unavailable");
  expect(dialog.textContent).not.toContain("30 tasks");
  expect(dialog.textContent).not.toContain("null");
  expect(dialog.textContent).toContain("24-hour lifetime expires");
  expect(dialog.textContent).not.toContain("60 minutes");
  act(() => [...dialog.querySelectorAll("button")].find(button => button.textContent === "Got it")!.click());
  expect(element.querySelector("textarea")?.value).toBe("Keep recovery details");
  expect(fetchMock).not.toHaveBeenCalled();
});
