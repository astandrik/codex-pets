// @vitest-environment jsdom
import {act, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {afterEach,expect,it,vi} from 'vitest';
import {GenerationRecoveryView,type RecoveryViewProps} from './GenerationRecoveryView';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=(()=>({matches:false,addEventListener(){},removeEventListener(){}})) as typeof window.matchMedia;
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
const props:RecoveryViewProps={generationId:'a'.repeat(64),options:{sourceRevision:'f'.repeat(64),canRebuild:true,canRegenerate:true,requiredStates:[],strips:[],rebuildsRemaining:2,issues:[],character:{baseUrl:'/base',expiresAt:'2030-01-01T00:00:00Z'}},mode:'regenerate',states:['idle'],busy:false,error:'',requestId:null,submitted:false,receiptExpired:false,sourceUnavailable:false,acceptedUrl:'',manualConfirmed:false,checkAttempted:false,onMode(){},onStates(){},onManualConfirmed(){},onSubmit(){},onCheck(){},onRefresh(){},onClose(){}};
it('keeps accepted private link available when copying fails',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const copy=vi.fn().mockRejectedValue(Error('denied'));Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:copy}});
 await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationRecoveryView generationId={'a'.repeat(64)} mode="regenerate" states={[]} busy={false} error="История недоступна" requestId="" submitted={false} receiptExpired={false} sourceUnavailable={false} acceptedUrl="/generated/accepted" manualConfirmed={false} checkAttempted={false} onMode={()=>{}} onStates={()=>{}} onManualConfirmed={()=>{}} onSubmit={()=>{}} onCheck={()=>{}} onRefresh={()=>{}} onClose={()=>{}} /></ThemeProvider>));
 expect(host.querySelector('a[href="/generated/accepted"]')).not.toBeNull();await act(async()=>host.querySelector<HTMLButtonElement>('[data-copy-result]')!.click());expect(host.textContent).toContain('вручную');expect(host.querySelector('input')?.value).toContain('/generated/accepted');
 await act(async()=>root.unmount());host.remove();
});

it('keeps receipt checking available and gates manual replay until both modes were visible',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const check=vi.fn(),submit=vi.fn();let modesVisible=false;
 vi.stubGlobal('innerWidth',320);vi.stubGlobal('innerHeight',568);
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){return this.tagName==='FIELDSET'||this.hasAttribute('data-recovery-mode')?new DOMRect(0,modesVisible?0:1000,320,150):new DOMRect(0,0,320,70);});
 function Fixture(){const [confirmed,setConfirmed]=useState(false);return <GenerationRecoveryView {...props} requestId="ea191c89-d657-4eec-a7d2-4a2e1e4a7ec7" checkAttempted manualConfirmed={confirmed} onManualConfirmed={setConfirmed} onCheck={check} onSubmit={submit}/>;}
 try{
  await act(async()=>root.render(<ThemeProvider theme="dark"><Fixture/></ThemeProvider>));
  await act(async()=>host.querySelector<HTMLInputElement>('.generation-recovery__manual input')!.click());
  const checkButton=host.querySelector<HTMLButtonElement>('[data-continuation-check]')!,retry=host.querySelector<HTMLButtonElement>('[data-continuation-submit]')!;
  expect(checkButton.closest('[inert], [aria-hidden="true"]')).toBeNull();expect(checkButton.disabled).toBe(false);expect(retry.disabled).toBe(true);
  await act(async()=>{checkButton.click();retry.click();});expect(check).toHaveBeenCalledOnce();expect(submit).not.toHaveBeenCalled();
  modesVisible=true;await act(async()=>window.dispatchEvent(new Event('scroll')));
  expect(retry.disabled).toBe(false);await act(async()=>retry.click());expect(submit).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('does not gate a frozen request replay or receipt check when source options are unavailable',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<ThemeProvider theme="light"><GenerationRecoveryView {...props} options={null} requestId="ea191c89-d657-4eec-a7d2-4a2e1e4a7ec7" submitted/></ThemeProvider>));
  expect(host.querySelector<HTMLButtonElement>('[data-continuation-submit]')!.disabled).toBe(false);
  expect(host.querySelector('[data-continuation-check]')!.closest('[inert]')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();}
});

it('shows the exact source deadline and tolerates older options without character',async()=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 try{
  await act(async()=>root.render(<ThemeProvider theme="light"><GenerationRecoveryView {...props} mode="rebuild"/></ThemeProvider>));
  expect(host.querySelector('time')?.dateTime).toBe(props.options!.character!.expiresAt);
  expect(host.textContent).toContain('не продлевает');
  await act(async()=>root.render(<ThemeProvider theme="light"><GenerationRecoveryView {...props} options={{...props.options!,character:undefined}} mode="rebuild"/></ThemeProvider>));
  expect(host.querySelector('time')).toBeNull();expect(host.textContent).toContain('Срок хранения прежний');expect(host.textContent).not.toContain('Invalid Date');
 }finally{await act(async()=>root.unmount());host.remove();}
});

it.each([100,240])('accepts sequentially viewed modes when each option is %spx high',async height=>{
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);let scroll=0;
 vi.stubGlobal('innerWidth',320);vi.stubGlobal('innerHeight',200);
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  if(this.tagName==='FIELDSET')return new DOMRect(0,-scroll,320,2*height+30);
  if(this.tagName==='LABEL')return new DOMRect(0,(this.textContent?.includes('Повторить сборку')?height+30:0)-scroll,320,height);
  return new DOMRect(0,130,320,70);
 });
 try{
  await act(async()=>root.render(<ThemeProvider theme="light"><GenerationRecoveryView {...props}/></ThemeProvider>));
  const button=host.querySelector<HTMLButtonElement>('[data-continuation-submit]')!;
  expect(button.disabled).toBe(true);
  for(const position of [0,height-100]){scroll=position;await act(async()=>window.dispatchEvent(new Event('scroll')));}
  expect(button.disabled).toBe(true);
  for(const position of [height+30,2*height-70]){scroll=position;await act(async()=>window.dispatchEvent(new Event('scroll')));}
  expect(button.disabled).toBe(false);expect(button.closest('[inert]')).toBeNull();
 }finally{await act(async()=>root.unmount());host.remove();}
});
