// @vitest-environment jsdom
/* eslint-disable @next/next/no-img-element */
import {act, type ReactNode} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {PetDownloadButton} from "@/components/PetDownloadButton/PetDownloadButton";
import {InstallCommandButton} from "@/components/InstallCommand/InstallCommandButton";
import {PetSharePanel} from "@/components/PetSharePanel/PetSharePanel";
import {PetDetailMoreActions} from "@/components/PetDetails/PetDetailMoreActions";
import {MyPetActions} from "@/components/MyPetActions/MyPetActions";
import {AdminSubmissionActions} from "@/components/AdminSubmissionActions/AdminSubmissionActions";
import {AdminGenerationRequestActions} from "@/components/AdminGenerationRequestActions/AdminGenerationRequestActions";
import {AboutResourceLinks} from "@/app/about/AboutResourceLinks";
import {GalleryFilter} from "@/components/GalleryFilter/GalleryFilter";
import {HomeHeroPetPicker} from "@/components/HomePage/HomeHeroPetPicker";

const mocks=vi.hoisted(()=>({add:vi.fn(),push:vi.fn(),refresh:vi.fn(),trackGoal:vi.fn()}));
vi.mock("next/navigation",()=>({useRouter:()=>mocks}));
vi.mock("@gravity-ui/uikit",async original=>({...await original<typeof import("@gravity-ui/uikit")>(),useToaster:()=>({add:mocks.add})}));
vi.mock("@/lib/metrics/yandex",()=>({trackGoal:mocks.trackGoal}));
vi.mock("next/image",()=>({default:({alt,...props}:React.ImgHTMLAttributes<HTMLImageElement>)=><img alt={alt??""} {...props}/>}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root,host:HTMLDivElement;
const writeText=vi.fn();
const share={name:"Fox",pageUrl:"https://example.test/pets/fox",cardGifUrl:"https://example.test/card.gif",embedUrl:"https://example.test/embed",badgeMarkdown:"[Fox](https://example.test)",installPrompt:"Install Fox"};
const hero={slug:"fox",displayName:"Fox",description:"Test pet",kind:"creature" as const,ownerName:null,ownerProfileSlug:null,publicAuthorEmail:null,spritesheetUrl:"/sheet.webp"};
beforeEach(()=>{vi.stubGlobal("ResizeObserver",class {observe(){} unobserve(){} disconnect(){}});vi.useFakeTimers();vi.clearAllMocks();sessionStorage.clear();host=document.createElement("div");document.body.append(host);root=createRoot(host);vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(null,{status:404})));window.matchMedia??=((query:string)=>({matches:false,media:query,addEventListener(){},removeEventListener(){},addListener(){},removeListener(){}})) as typeof window.matchMedia;Object.defineProperty(navigator,"clipboard",{configurable:true,value:{writeText:writeText.mockResolvedValue(undefined)}});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.useRealTimers();vi.unstubAllGlobals();});
async function render(node:ReactNode){await act(async()=>root.render(<ThemeProvider theme="light">{node}</ThemeProvider>));}
function assertIconSlots(minimum:number){const svgs=host.querySelectorAll('.g-button svg');expect(svgs.length).toBeGreaterThanOrEqual(minimum);for(const svg of svgs)expect(svg.closest('.g-button__icon')).not.toBeNull();expect(host.querySelector('button button, a a, button a, a button')).toBeNull();}
describe("client button icon slots",()=>{
 const cases:[string,()=>ReactNode,number][]=[
  ["download",()=> <PetDownloadButton slug="fox"/>,1],
  ["install",()=> <InstallCommandButton slug="fox" surface="card"/>,1],
  ["sharing",()=> <PetSharePanel slug="fox" source={share}/>,4],
  ["detail menu",()=> <PetDetailMoreActions petId="fox" slug="fox" petJsonUrl="/pet.json" spritesheetUrl="/sheet.webp"/>,1],
  ["my pet deletion",()=> <MyPetActions petId="fox"/>,1],
  ["submission actions",()=> <AdminSubmissionActions petId="fox" publicEmailRequested={false} contactEmail={null}/>,2],
  ["generation request actions",()=> <AdminGenerationRequestActions requestId="fox" status="pending"/>,2],
  ["about resources",()=> <AboutResourceLinks githubUrl="https://example.test/git" npmPackageUrl="https://example.test/npm"/>,2],
  ["gallery clear",()=> <GalleryFilter defaultQuery="fox" defaultKind="all" defaultTags={[]} suggestedTags={[]}/>,1],
  ["lucky picker",()=> <HomeHeroPetPicker pets={[hero,{...hero,slug:"owl"}]} initialIndex={0}/>,3],
 ];
 it.each(cases)("uses actual UIKit slots for %s",async(_name,node,count)=>{await render(node());assertIconSlots(count);expect(vi.mocked(fetch).mock.calls.some(([,options])=>options?.method==='POST')).toBe(false);});
 it("keeps copy, success, failure and reset inside the icon slot",async()=>{
  await render(<InstallCommandButton slug="fox" surface="detail"/>);const button=host.querySelector('button')!;
  await act(async()=>button.click());expect(writeText).toHaveBeenCalledExactlyOnceWith("npx @astandrik/codex-pets install fox");expect(button.textContent).toBe("Copied");assertIconSlots(1);
  expect(mocks.trackGoal).toHaveBeenCalledExactlyOnceWith("pet_install_command_copy",{slug:"fox",surface:"detail"});
  await act(async()=>vi.advanceTimersByTimeAsync(1800));expect(button.textContent).toBe("Copy");
  writeText.mockRejectedValueOnce(Error("denied"));await act(async()=>button.click());expect(button.textContent).toBe("Failed");assertIconSlots(1);expect(mocks.trackGoal).toHaveBeenCalledTimes(1);
  await act(async()=>vi.advanceTimersByTimeAsync(2200));expect(button.textContent).toBe("Copy");
 });
 it("copies a share snippet once and keeps success/failure icons in the slot",async()=>{
  await render(<PetSharePanel slug="fox" source={share}/>);
  const button=host.querySelector<HTMLButtonElement>('button[aria-label="Copy README badge"]')!;
  await act(async()=>button.click());
  expect(writeText).toHaveBeenCalledExactlyOnceWith(share.badgeMarkdown);
  expect(button.textContent).toBe("Copied");assertIconSlots(4);
  expect(mocks.trackGoal).toHaveBeenCalledExactlyOnceWith("pet_share_snippet_copy",{mode:"sprite",scale:2,slug:"fox",state:"idle",snippet:"badge"});
  await act(async()=>vi.advanceTimersByTimeAsync(1800));expect(button.textContent).toBe("Copy");
  writeText.mockRejectedValueOnce(Error("denied"));await act(async()=>button.click());
  expect(button.textContent).toBe("Failed");assertIconSlots(4);expect(mocks.trackGoal).toHaveBeenCalledTimes(1);
  await act(async()=>vi.advanceTimersByTimeAsync(2200));expect(button.textContent).toBe("Copy");
 });

});
