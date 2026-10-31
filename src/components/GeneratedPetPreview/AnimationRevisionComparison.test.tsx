// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {AnimationRevisionComparison} from "./AnimationRevisionComparison";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false})) as typeof window.matchMedia;
let root:Root,element:HTMLDivElement;const accepted=vi.fn(),fetchMock=vi.fn();
beforeEach(()=>{vi.useFakeTimers();element=document.createElement("div");document.body.append(element);root=createRoot(element);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset();accepted.mockReset();});
afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.useRealTimers();vi.unstubAllGlobals();});
it("synchronizes real preview frames and accepts only on explicit click",async()=>{
  fetchMock.mockImplementation(async (_url,init)=>init?.method==="POST"?{ok:true,json:async()=>({generation:{animationRevision:{acceptedAt:42}}})}:{ok:true,text:async()=>JSON.stringify({id:"pet",displayName:"Pet",description:"Pet",spritesheetPath:"spritesheet.webp",spriteVersionNumber:2})});
  await act(async()=>root.render(<ThemeProvider theme="light"><AnimationRevisionComparison generationId={"b".repeat(64)} sourceGenerationId={"a".repeat(64)} expiresAt={new Date(Date.now()+86400000).toISOString()} petJsonUrl="/pet.json" spritesheetUrl="/after.webp" beforeSpritesheetUrl="/before.webp" selectedStates={["waving"]} onAccepted={accepted}/></ThemeProvider>));
  const sprites=()=>[...element.querySelectorAll<HTMLElement>(".state-preview__sprite")];
  expect(sprites()).toHaveLength(2);
  await act(async()=>vi.advanceTimersByTimeAsync(700));
  expect(sprites()[0].style.backgroundPosition).toBe(sprites()[1].style.backgroundPosition);
  expect(sprites()[0].style.backgroundImage).toContain("before.webp");expect(sprites()[1].style.backgroundImage).toContain("after.webp");
  expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
  await act(async()=>[...element.querySelectorAll("button")].find(b=>b.textContent==="Принять новую версию")!.click());
  expect(accepted).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
});

const acceptanceButton = () => [...element.querySelectorAll("button")].find(button => button.textContent === "Принять новую версию")!;
const previewResponse = () => ({ok: true, text: async () => JSON.stringify({id: "pet", displayName: "Pet", description: "Pet", spritesheetPath: "spritesheet.webp", spriteVersionNumber: 2})});
async function renderCandidate() {
  await act(async () => root.render(<ThemeProvider theme="light"><AnimationRevisionComparison generationId={"b".repeat(64)} sourceGenerationId={"a".repeat(64)} expiresAt={new Date(Date.now() + 1000).toISOString()} petJsonUrl="/pet.json" spritesheetUrl="/after.webp" beforeSpritesheetUrl="/before.webp" selectedStates={["idle"]} onAccepted={accepted}/></ThemeProvider>));
}

it("keeps both previews synchronized at 350ms after switching states", async () => {
  fetchMock.mockImplementation(async () => previewResponse());
  await renderCandidate();
  const positions = () => [...element.querySelectorAll<HTMLElement>(".state-preview__sprite")].map(node => node.style.backgroundPosition);
  const first = positions();
  await act(async () => vi.advanceTimersByTimeAsync(349));
  expect(positions()).toEqual(first);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(positions()[0]).not.toBe(first[0]);
  expect(positions()[0]).toBe(positions()[1]);
  await act(async () => {
    const select = element.querySelector("select")!;
    select.value = "running";
    select.dispatchEvent(new Event("change", {bubbles: true}));
  });
  const working = positions();
  await act(async () => vi.advanceTimersByTimeAsync(349));
  expect(positions()).toEqual(working);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(positions()[0]).not.toBe(working[0]);
  expect(positions()[0]).toBe(positions()[1]);
});

it.each([404, 410].flatMap(status => ["json", "empty", "html"].map(body => ({status, body}))))("disables acceptance after terminal $status with $body body", async ({status, body}) => {
  const json = vi.fn(async () => {
    if (body !== "json") throw new SyntaxError(body === "empty" ? "Unexpected end of JSON input" : "Unexpected token <");
    return {code: status === 410 ? "generation_expired" : "not_found"};
  });
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? {ok: false, status, json} : previewResponse());
  await renderCandidate();
  await act(async () => vi.advanceTimersByTimeAsync(1001));
  await act(async () => acceptanceButton().click());
  expect(element.querySelector('[role="alert"]')?.textContent).toContain(status === 410 ? "Срок хранения этой версии истёк" : "Эта версия больше недоступна");
  expect(element.textContent).not.toContain("Повторите действие");
  expect(acceptanceButton().disabled).toBe(true);
  expect(accepted).not.toHaveBeenCalled();
  expect(json).not.toHaveBeenCalled();
  await act(async () => acceptanceButton().click());
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

it.each(["network", "503", "invalid-success"])("keeps %s uncertainty retryable and accepts a later confirmed response", async failure => {
  let posts = 0;
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return previewResponse();
    if (posts++ === 0) {
      if (failure === "network") throw new TypeError("connection lost");
      if (failure === "503") return {ok: false, status: 503, json: async () => ({code: "generation_unavailable"})};
      return {ok: true, status: 200, json: async () => {throw new SyntaxError("truncated receipt");}};
    }
    return {ok: true, status: 200, json: async () => ({generation: {animationRevision: {acceptedAt: 42}}})};
  });
  await renderCandidate();
  await act(async () => acceptanceButton().click());
  expect(element.textContent).toContain("Повторите действие");
  expect(acceptanceButton().disabled).toBe(false); expect(accepted).not.toHaveBeenCalled();
  await act(async () => acceptanceButton().click());
  expect(accepted).toHaveBeenCalledTimes(1); expect(posts).toBe(2);
});
