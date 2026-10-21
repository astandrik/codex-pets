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
  await act(async()=>vi.advanceTimersByTimeAsync(280));
  expect(sprites()[0].style.backgroundPosition).toBe(sprites()[1].style.backgroundPosition);
  expect(sprites()[0].style.backgroundImage).toContain("before.webp");expect(sprites()[1].style.backgroundImage).toContain("after.webp");
  expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
  await act(async()=>[...element.querySelectorAll("button")].find(b=>b.textContent==="Принять новую версию")!.click());
  expect(accepted).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
});
