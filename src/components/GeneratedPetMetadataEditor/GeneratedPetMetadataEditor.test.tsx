// @vitest-environment jsdom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {GeneratedPetMetadataEditor} from "./GeneratedPetMetadataEditor";
import type {PublicCardMetadata} from "@/lib/pets/generation/card-metadata";
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
window.matchMedia??=((query:string)=>({matches:false,media:query,onchange:null,addListener(){},removeListener(){},addEventListener(){},removeEventListener(){},dispatchEvent:()=>false}))as typeof window.matchMedia;
const id="a".repeat(64),metadata:PublicCardMetadata={description:"A blue cartoon bus.",tags:["vehicle","blue"],revision:0,editable:true,automaticState:"completed",edited:false};
let root:Root,element:HTMLDivElement;const fetchMock=vi.fn(),blocked=vi.fn(),saved=vi.fn();
beforeEach(()=>{element=document.createElement('div');document.body.append(element);root=createRoot(element);vi.stubGlobal('fetch',fetchMock);fetchMock.mockReset();blocked.mockReset();saved.mockReset();});afterEach(async()=>{await act(async()=>root.unmount());element.remove();vi.unstubAllGlobals();});
async function render(value=metadata,disabled=false){await act(async()=>root.render(<ThemeProvider theme="light"><GeneratedPetMetadataEditor generationId={id} metadata={value} disabled={disabled} onBlocked={blocked} onSaved={saved}/></ThemeProvider>));}
function edit(value:string){const input=element.querySelector('textarea')!;act(()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));});}
async function submit(){await act(async()=>element.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
describe('generated card editor',()=>{
 it('shows automatic fields, protects dirty input from polls and saves once with revision',async()=>{
  await render();expect(element.querySelector('textarea')?.value).toBe(metadata.description);edit('My edited description');expect(blocked).toHaveBeenLastCalledWith(true);
  await render({...metadata,description:'Other poll'});expect(element.querySelector('textarea')?.value).toBe('My edited description');
  let resolve!:(value:unknown)=>void;fetchMock.mockImplementationOnce(()=>new Promise(r=>{resolve=r}));await submit();await submit();expect(fetchMock).toHaveBeenCalledTimes(1);expect(fetchMock.mock.calls[0][1]).toMatchObject({method:'PUT',body:JSON.stringify({description:'My edited description',tags:metadata.tags,revision:0})});
  const next={...metadata,description:'My edited description',revision:1,edited:true};await act(async()=>resolve({ok:true,json:async()=>({metadata:next})}));expect(saved).toHaveBeenCalledWith(next);expect(blocked).toHaveBeenLastCalledWith(false);
 });
 it('does not overwrite a conflict and offers explicit reload without another request',async()=>{
  await render();edit('Unsaved');fetchMock.mockResolvedValueOnce({ok:false,status:409,json:async()=>({code:'metadata_conflict',message:'private internal error'})});await submit();expect(element.querySelector('textarea')?.value).toBe('Unsaved');expect(element.textContent).toContain('another tab');expect(element.textContent).not.toContain('private internal');expect(element.querySelector('a')?.href).toContain('/generated/'+id);expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it('locks fields after submission and never sends an edit',async()=>{await render({...metadata,editable:false},true);expect(element.querySelector('textarea')?.readOnly).toBe(true);await submit();expect(fetchMock).not.toHaveBeenCalled();});
 it('does not confuse a save failure with an image retry',async()=>{await render();edit('My draft');fetchMock.mockRejectedValueOnce(Error('network'));await submit();expect(element.textContent).toContain('Could not confirm');expect(element.querySelector('textarea')?.value).toBe('My draft');expect(blocked).not.toHaveBeenCalledWith(false);});
});

it('edits the saved name together with the description and tags',async()=>{
 await render({...metadata,displayName:'Generated pet'});const input=element.querySelector<HTMLInputElement>('#generated-name');expect(input?.value).toBe('Generated pet');
 act(()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Синебус');input!.dispatchEvent(new Event('input',{bubbles:true}));});
 fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({metadata:{...metadata,displayName:'Синебус',revision:1,edited:true}})});
 await submit();expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({displayName:'Синебус',description:metadata.description,tags:metadata.tags,revision:0});
 expect(saved).toHaveBeenCalledWith(expect.objectContaining({displayName:'Синебус'}));
});
