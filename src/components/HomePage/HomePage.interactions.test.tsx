// @vitest-environment jsdom
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {Providers} from '@/app/Providers';
import {HomePage} from './HomePage';
import {GalleryFilter} from '@/components/GalleryFilter/GalleryFilter';
import {PetCatalog} from '@/components/PetCatalog/PetCatalog';
import type {PublicPetPayload} from '@/lib/pets/api-payloads';
const router=vi.hoisted(()=>({push:vi.fn(),replace:vi.fn(),refresh:vi.fn()}));
vi.mock('next/navigation',()=>({useRouter:()=>router}));
vi.mock('next/link',()=>({default:({href,children,...props}:React.AnchorHTMLAttributes<HTMLAnchorElement>)=><a href={href} {...props}>{children}</a>}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia ??= ((media:string)=>({media,matches:false,addEventListener(){},removeEventListener(){}})) as typeof window.matchMedia;
window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
let root:Root,el:HTMLDivElement;const request=vi.fn();
const pets:PublicPetPayload[]=Array.from({length:50},(_,i)=>({id:`pet${i}`,slug:`pet${i}`,displayName:`Pet ${i}`,description:'A long visible description',kind:'creature',tags:['cute','blue'],status:'approved',spritesheetUrl:'/api/assets/test/spritesheet.webp',petJsonUrl:'/api/assets/test/pet.json',zipUrl:'/api/assets/test/pet.zip',spritesheetExt:'webp',ownerName:'Creator',ownerProfileSlug:'creator',ownerProfileUrl:'/users/creator',ownerAvatarUrl:null,publicAuthorEmail:null,createdAt:'2026-01-01T00:00:00Z',approvedAt:'2026-01-01T00:00:00Z',likeCount:0,downloadCount:2,installCount:3}));
beforeEach(async()=>{el=document.createElement('div');document.body.append(el);root=createRoot(el);localStorage.clear();request.mockReset();vi.stubGlobal('fetch',request);await act(async()=>root.render(<Providers><HomePage pets={pets} totalPets={50} catalogTotalPets={50} showLandingContent catalog={<><GalleryFilter layout="home" defaultQuery="" defaultKind="all" defaultTags={[]} suggestedTags={['cute','blue']}/><PetCatalog cardLayout="home" initialPets={pets.slice(0,24)} initialPage={1} pageSize={24} totalItems={50} totalPages={3} snapshotVersion="s1" rankingVersion="r1" filters={{query:'',kind:'all',tags:[]}}/></>}/></Providers>));});
afterEach(async()=>{await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('keeps a single live catalog and selected tags through disclosure/resize without POST',async()=>{
 expect(el.querySelectorAll('.pet-card')).toHaveLength(24);expect(el.querySelectorAll('form')).toHaveLength(1);expect(request).not.toHaveBeenCalled();
 const cute=[...el.querySelectorAll('button')].find(b=>b.textContent==='#cute')!;await act(async()=>cute.click());expect(cute.getAttribute('aria-pressed')).toBe('true');
 const toggle=[...el.querySelectorAll('button')].find(b=>b.textContent?.startsWith('Tags'))!;await act(async()=>toggle.click());expect(el.querySelector<HTMLElement>('.gallery-filter-card__tags')!.hidden).toBe(true);
 await act(async()=>{window.dispatchEvent(new Event('resize'));toggle.click();});expect(cute.getAttribute('aria-pressed')).toBe('true');
 await act(async()=>cute.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(document.activeElement).toBe(toggle);expect(request).not.toHaveBeenCalled();
});
it('keeps loaded cards and renders the next page using the existing catalog contract',async()=>{
 request.mockResolvedValue(new Response(JSON.stringify({total:24,pets:pets.slice(24,48),pagination:{page:2,pageSize:24,totalItems:50,totalPages:3,hasNextPage:true}}),{headers:{'Content-Type':'application/json','X-Codex-Pets-Catalog-Snapshot':'s1','X-Codex-Pets-Catalog-Ranking':'r1'}}));
 await act(async()=>[...el.querySelectorAll('button')].find(b=>b.textContent==='Load more')!.click());expect(el.querySelectorAll('.pet-card')).toHaveLength(48);expect(request).toHaveBeenCalledTimes(1);expect(String(request.mock.calls[0][0])).toContain('page=2');
});
it('retains one-way Like behavior in the real home card',async()=>{
 request.mockResolvedValue(new Response(JSON.stringify({likeCount:1}),{headers:{'Content-Type':'application/json'}}));
 const like=el.querySelector<HTMLButtonElement>('button[aria-label^="Like Pet 0:"]')!;await act(async()=>like.click());expect(request).toHaveBeenCalledTimes(1);expect(like.disabled).toBe(true);expect(like.textContent).toContain('Liked 1');await act(async()=>like.click());expect(request).toHaveBeenCalledTimes(1);
});
it('copies the install command and AI prompt only on explicit clicks',async()=>{
 const write=vi.fn().mockResolvedValue(undefined);Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:write}});
 await act(async()=>el.querySelector<HTMLButtonElement>('button[aria-label="Copy install command for pet0"]')!.click());expect(write).toHaveBeenNthCalledWith(1,'npx @astandrik/codex-pets install pet0');
 await act(async()=>[...el.querySelectorAll('button')].find(b=>b.textContent==='Copy prompt')!.click());expect(write.mock.calls[1][0]).toContain('Do not submit a generation');expect(request).not.toHaveBeenCalled();
});

it('keeps the catalog after a failed append and retries only on an explicit click', async () => {
  request.mockResolvedValueOnce(new Response('', {status: 500}));
  await act(async () => [...el.querySelectorAll('button')].find(button => button.textContent === 'Load more')!.click());
  expect(el.querySelectorAll('.pet-card')).toHaveLength(24);
  expect(el.textContent).toContain('Retry');
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce(new Response(JSON.stringify({total:24,pets:pets.slice(24,48),pagination:{page:2,pageSize:24,totalItems:50,totalPages:3,hasNextPage:true}}), {headers:{'Content-Type':'application/json','X-Codex-Pets-Catalog-Snapshot':'s1','X-Codex-Pets-Catalog-Ranking':'r1'}}));
  await act(async () => [...el.querySelectorAll('button')].find(button => button.textContent === 'Retry')!.click());
  expect(el.querySelectorAll('.pet-card')).toHaveLength(48);
  expect(request).toHaveBeenCalledTimes(2);
});
it('shows the existing Like error and allows only an explicit retry', async () => {
  request.mockResolvedValueOnce(new Response('', {status: 500}));
  const like=el.querySelector<HTMLButtonElement>('button[aria-label^="Like Pet 0:"]')!;
  await act(async () => like.click());
  expect(document.body.textContent).toContain('Like failed');
  expect(like.disabled).toBe(false);
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValueOnce(new Response(JSON.stringify({likeCount:1}),{headers:{'Content-Type':'application/json'}}));
  await act(async () => like.click());
  expect(like.disabled).toBe(true);
  expect(request).toHaveBeenCalledTimes(2);
});
