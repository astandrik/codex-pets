// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {expect,it,vi} from 'vitest';
import {GenerationLimitsDialog} from './GenerationLimitsDialog';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
it('describes the saved four-attempt policy without making requests', async () => {
  const host=document.createElement('div'); document.body.append(host); const root=createRoot(host);
  const request=vi.fn(); vi.stubGlobal('fetch',request);
  window.matchMedia ??= (()=>({matches:false,addEventListener(){},removeEventListener(){}})) as unknown as typeof window.matchMedia;
  try {
    await act(async()=>root.render(<ThemeProvider theme="dark"><GenerationLimitsDialog open onClose={()=>{}} reviewBase automaticAnimationRepair/></ThemeProvider>));
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('up to 3 additional times');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('same task');
    expect(request).not.toHaveBeenCalled();
  } finally {await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();}
});
it('shows short and full conditions without network calls and returns focus on Escape', async () => {
  const host=document.createElement('div');document.body.append(host);const root=createRoot(host);const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
  window.matchMedia ??= (()=>({matches:false,addEventListener(){},removeEventListener(){}})) as unknown as typeof window.matchMedia;
  const trigger=document.createElement('button');document.body.append(trigger);trigger.focus();
  const close=vi.fn();
  const render=(open:boolean)=>act(()=>root.render(<ThemeProvider theme="light"><GenerationLimitsDialog open={open} onClose={close} reviewBase /></ThemeProvider>));
  try {
    render(false); render(true);
    const dialog=document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('200');expect(dialog.textContent).toContain('10 per IP');expect(dialog.textContent).toContain('24 hours from task acceptance');
    const full=[...dialog.querySelectorAll('button')].find(b=>b.textContent==='Full details')!;act(()=>full.click());
    expect(dialog.textContent).toContain('30 minutes');expect(dialog.textContent).toContain('additional AI request');expect(dialog.textContent).toContain('retried once');expect(dialog.textContent).toContain('midnight Moscow');
    expect(document.activeElement?.tagName).toBe('H2');
    act(()=>document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',code:'Escape',bubbles:true})));expect(close).toHaveBeenCalledOnce();
    render(false);await act(async()=>{await new Promise(r=>setTimeout(r,350));});expect(document.activeElement).toBe(trigger);
    expect(fetch).not.toHaveBeenCalled();
  } finally {await act(async()=>root.unmount());host.remove();trigger.remove();vi.unstubAllGlobals();}
});

it('locks page scroll only while the retained dialog is open', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const close = vi.fn();
  window.matchMedia ??= (() => ({matches:false,addEventListener(){},removeEventListener(){}})) as unknown as typeof window.matchMedia;
  const render = async (open: boolean) => act(async () => root.render(<ThemeProvider theme="light"><GenerationLimitsDialog open={open} onClose={close} reviewBase/></ThemeProvider>));
  try {
    await render(false);
    expect(document.body.style.overflow).not.toBe('hidden');
    await render(true);
    expect(document.body.style.overflow).toBe('hidden');
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Full details')!.click());
    await render(false);
    expect(document.body.style.overflow).not.toBe('hidden');
    expect(document.getElementById('generation-limits-title')).not.toBeNull();
    await render(true);
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.getElementById('generation-limits-title')?.textContent).toBe('Generation details & privacy');
  } finally {await act(async () => root.unmount());host.remove();}
  expect(document.body.style.overflow).not.toBe('hidden');
});
