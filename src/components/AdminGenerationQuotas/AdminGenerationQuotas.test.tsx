// @vitest-environment jsdom
import {webcrypto}from'node:crypto';
import{act}from'react';import{createRoot,type Root}from'react-dom/client';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import{ThemeProvider}from'@gravity-ui/uikit';
import{AdminGenerationQuotas}from'./AdminGenerationQuotas';
import{prepareQuotaGrant}from'./request';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false}))as typeof window.matchMedia;
window.ResizeObserver??=class{observe(){} unobserve(){} disconnect(){}};
let container:HTMLDivElement;let root:Root;const fetchMock=vi.fn();
const quota={ip:'203.0.113.5',day:'2026-10-11',expiresAt:'2026-10-11T21:00:00Z',ipUsed:3,extra:0,ipLimit:3,ipRemaining:0,globalUsed:5,globalLimit:30,globalRemaining:25};
beforeEach(()=>{vi.clearAllMocks();sessionStorage.clear();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('fetch',fetchMock);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.unstubAllGlobals();});
function setInput(id:string,value:string){const el=container.querySelector<HTMLInputElement>('#'+id)!;act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
async function click(text:string){await act(async()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent===text)!;expect(b).toBeDefined();b.click();await new Promise(r=>setTimeout(r,15));});}
async function setup(){act(()=>root.render(<ThemeProvider theme="light"><AdminGenerationQuotas/></ThemeProvider>));setInput('quota-ip','203.0.113.5');fetchMock.mockResolvedValueOnce(Response.json({quota}));await click('Check quota');}
describe('admin additional attempts',()=>{
 it('reviews and grants more than thirty additional attempts',async()=>{
  await setup();setInput('quota-amount','100');
  const review=[...container.querySelectorAll('button')].find(x=>x.textContent==='Review grant')!;
  expect(review.disabled).toBe(false);await click('Review grant');
  expect(document.body.textContent).toContain('Add 100 attempts');
  fetchMock.mockResolvedValueOnce(Response.json({quota:{...quota,extra:100,ipLimit:110,ipRemaining:107},receipt:{requestId:'large-receipt',day:quota.day,amount:100,totalExtra:100,grantedAt:'2026-10-11T12:00:00Z',expiresAt:quota.expiresAt}}));
  await click('Grant attempts');expect(JSON.parse(fetchMock.mock.calls[1][1].body).amount).toBe(100);
  expect(container.textContent).toContain('100 additional attempts granted');expect(container.textContent).toContain('3 / 110');
 });
 it('previews IP and global counters and requires explicit confirmation before granting',async()=>{
  await setup();expect(container.textContent).toContain('3 / 3');expect(container.textContent).toContain('5 / 30');expect(fetchMock).toHaveBeenCalledOnce();
  setInput('quota-amount','2');await click('Review grant');expect(document.body.textContent).toContain('203.0.113.5');expect(fetchMock).toHaveBeenCalledOnce();
  fetchMock.mockResolvedValueOnce(Response.json({quota:{...quota,extra:2,ipLimit:5,ipRemaining:2},receipt:{requestId:'receipt',day:quota.day,amount:2,totalExtra:2,grantedAt:'2026-10-11T12:00:00Z',expiresAt:quota.expiresAt}}));
  await click('Grant attempts');const call=fetchMock.mock.calls[1];expect(call[0]).toBe('/api/admin/generation-quotas/grants');expect(JSON.parse(call[1].body)).toMatchObject({ip:quota.ip,amount:2,day:quota.day});
  expect(container.textContent).toContain('2 additional attempts granted');expect(container.textContent).toContain('3 / 5');expect(container.textContent).toContain('Budget and expense history');
 });
 it('retries an unknown reply with the same grant ID and locks editable inputs',async()=>{
  await setup();await click('Review grant');fetchMock.mockRejectedValueOnce(Error('network'));await click('Grant attempts');
  const first=JSON.parse(fetchMock.mock.calls[1][1].body);expect(container.textContent).toContain('Could not confirm');expect(container.querySelector<HTMLInputElement>('#quota-ip')?.disabled).toBe(true);
  fetchMock.mockResolvedValueOnce(Response.json({quota:{...quota,extra:first.amount,ipLimit:3+first.amount,ipRemaining:first.amount},receipt:{requestId:first.requestId,day:quota.day,amount:first.amount,totalExtra:first.amount,grantedAt:'2026-10-11T12:00:00Z',expiresAt:quota.expiresAt}}));
  await click('Retry same grant');expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual(first);
 });
 it('clears stale quota after changing IP and sends no grant on cancel',async()=>{
  await setup();await click('Review grant');await click('Cancel');expect(fetchMock).toHaveBeenCalledOnce();setInput('quota-ip','203.0.113.6');
  expect(container.querySelector('#quota-amount')).toBeNull();expect(fetchMock).toHaveBeenCalledOnce();
 });
});
it('lets the admin refresh the day after an explicit midnight rejection',async()=>{
 await setup();await click('Review grant');fetchMock.mockResolvedValueOnce(Response.json({code:'quota_day_changed'},{status:409}));await click('Grant attempts');
 expect(container.textContent).toContain('Moscow day changed');expect(container.querySelector<HTMLInputElement>('#quota-ip')?.disabled).toBe(false);
 expect(container.querySelector('#quota-amount')).toBeNull();
});

it('restores an unknown grant amount after reload and rejects a different IP without a second grant',async()=>{
 await prepareQuotaGrant(sessionStorage,{ip:quota.ip,amount:2,day:quota.day});
 act(()=>root.render(<ThemeProvider theme="light"><AdminGenerationQuotas/></ThemeProvider>));
 expect(container.textContent).toContain('Unconfirmed grant');setInput('quota-ip','203.0.113.6');
 fetchMock.mockResolvedValueOnce(Response.json({quota:{...quota,ip:'203.0.113.6'}}));await click('Check quota');
 expect(container.querySelector<HTMLInputElement>('#quota-amount')?.value).toBe('2');
 await click('Retry same grant');expect(fetchMock).toHaveBeenCalledOnce();expect(container.textContent).toContain('original IP');
});
it('keeps the entered IPv6 spelling for reading and granting legacy usage',async()=>{
 const ip='2001:0db8:0000:0000:0000:0000:0000:0005';act(()=>root.render(<ThemeProvider theme="light"><AdminGenerationQuotas/></ThemeProvider>));
 setInput('quota-ip',ip);fetchMock.mockResolvedValueOnce(Response.json({quota:{...quota,ip:'2001:db8::5'}}));await click('Check quota');
 expect(container.querySelector<HTMLInputElement>('#quota-ip')?.value).toBe(ip);
 await click('Review grant');fetchMock.mockResolvedValueOnce(Response.json({quota:{...quota,ip:'2001:db8::5',extra:1,ipLimit:4,ipRemaining:1},receipt:{requestId:'receipt',amount:1,totalExtra:1,day:quota.day,grantedAt:'2026-10-11T12:00:00Z',expiresAt:quota.expiresAt}}));await click('Grant attempts');
 expect(JSON.parse(fetchMock.mock.calls[1][1].body).ip).toBe(ip);expect(container.textContent).toContain('3 / 4');
});
