// @vitest-environment jsdom
import {act} from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider} from '@gravity-ui/uikit';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {PetGenerationBatch} from './PetGenerationBatch';

const mocks=vi.hoisted(()=>({prepare:vi.fn(),add:vi.fn()}));
vi.mock('./prepare-reference-image',async original=>({
  ...await original<typeof import('./prepare-reference-image')>(),prepareReferenceImage:mocks.prepare,
}));
vi.mock('./batch-store',()=>({openBatchStore:async()=>({read:async()=>null,maintain:async()=>{},add:mocks.add})}));
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  vi.stubGlobal('indexedDB',{});
  Object.defineProperty(navigator,'locks',{configurable:true,value:{
    query:async()=>({held:[]}),
    request:async(_key:unknown,_options:unknown,callback:(lock:object)=>unknown)=>callback({}),
  }});
});
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});

it.each(['pause','disable','unmount'])('revokes the prepared image when %s happens before thumbnail rejection',async action=>{
  const revoke=vi.fn();
  vi.stubGlobal('URL',{revokeObjectURL:revoke,createObjectURL:()=> 'blob:prepared'});
  let finishDecode:()=>void=()=>{};
  let decoding=false;
  vi.stubGlobal('Image',class {
    naturalWidth=6000;naturalHeight=6000;src='';
    decode(){decoding=true;return new Promise<void>(resolve=>{finishDecode=resolve;});}
  });
  const file=new File(['small compressed fixture'],'image.png',{type:'image/png'});
  mocks.prepare.mockResolvedValue({file,url:'blob:prepared'});
  const host=document.createElement('div');document.body.append(host);
  const root=createRoot(host);let unmounted=false;
  try {
    await act(async()=>{
      root.render(<ThemeProvider theme="dark"><PetGenerationBatch enabled/></ThemeProvider>);
      await new Promise(resolve=>setTimeout(resolve,20));
    });
    const input=host.querySelector('input')!;
    Object.defineProperty(input,'files',{configurable:true,value:[file]});
    await act(async()=>{
      input.dispatchEvent(new Event('change',{bubbles:true}));
      await vi.waitFor(()=>expect(decoding).toBe(true));
    });
    if(action==='pause'){
      await act(async()=>[...host.querySelectorAll('button')].find(button=>button.textContent?.includes('Пауза после'))!.click());
    } else if(action==='disable'){
      await act(async()=>root.render(<ThemeProvider theme="dark"><PetGenerationBatch enabled={false}/></ThemeProvider>));
    } else {
      await act(async()=>root.unmount());unmounted=true;
    }
    await act(async()=>{finishDecode();await new Promise(resolve=>setTimeout(resolve,0));});
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:prepared');
    expect(mocks.add).not.toHaveBeenCalled();
    expect(mocks.prepare.mock.calls[0][1].aborted).toBe(true);
  } finally {
    if(!unmounted)await act(async()=>root.unmount());
    host.remove();
  }
});
