"use client";

import {useCallback,useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore,type ComponentProps} from "react";
import Link from "next/link";
import {Button,Label,Text} from "@gravity-ui/uikit";
import {withBasePath} from "@/lib/base-path";
import {HISTORY_PREFIX,HISTORY_FAMILY_LIMIT,isGenerationHistoryKey,rememberGenerationVersion,historyParent,parseHistoryGeneration,readGenerationHistory,readGenerationHistoryForReconciliation,pruneGenerationHistory,type GenerationHistoryEntry} from "@/lib/pets/generation/history";
import {GenerationThumbnail} from "./GenerationThumbnail";
import {cachedHistoryStatus,cacheHistoryStatus,historyStatusFresh,pruneHistoryStatuses,type HistoryStatus} from "./history-status-cache";
import {animationRepairProgressText} from "@/lib/pets/generation/animation-repair-progress";
import {groupGenerationVersions,versionTime} from "@/lib/pets/generation/history-families";
import "./MyGenerations.scss";

type Result=HistoryStatus;
type Row=GenerationHistoryEntry&Result&{expired:boolean};
type Refresh={version:number;force:boolean;imageRetry:number};
const subscribeToBrowser=()=>()=>{};
const LABELS={queued:"Queued",generating:"Generating",awaiting_confirmation:"Review character",processing:"Processing",completed:"Ready",failed:"Failed"};
const live=(result?:Result)=>!result?.generation||["queued","generating","processing"].includes(result.generation.status);
function needsStatusRead(result?:Result){
  const failedReads=result?.failedReads??0;
  return !result?.unavailable&&failedReads<3&&(live(result)||failedReads>0);
}

function HistoryNavigationLink(props:ComponentProps<typeof Link>&{component?:unknown}){
  // Keep native link semantics and omit Gravity's custom-component prop.
  const linkProps={...props};delete linkProps.component;delete linkProps.role;
  return <Link {...linkProps}/>;
}

function statusLabel(row:Row,expired:boolean){
  if(expired)return "Expired";
  if(row.generation?.status === "generating" && animationRepairProgressText(row.generation.animationRepair))return "Repairing animations";
  if(row.generation?.status==="completed" && row.generation.animationRevision) return row.generation.animationRevision.acceptedAt === undefined ? "На проверке" : "Готово";
  if(row.generation)return LABELS[row.generation.status];
  return row.failedReads?"Status unavailable":"Checking status";
}
function statusTheme(row:Row,expired:boolean):"unknown"|"success"|"danger"|"info"{
  if(expired)return "unknown";
  if(row.generation?.status==="completed")return "success";
  if(row.generation?.status==="failed")return "danger";
  return "info";
}

export function MyGenerations(){
  const browser=useSyncExternalStore(subscribeToBrowser,()=>true,()=>false);
  const [refresh,setRefresh]=useState<Refresh>({version:0,force:false,imageRetry:0});
  useEffect(()=>{
    const onStorage=(event:StorageEvent)=>{if(event.key===null||isGenerationHistoryKey(event.key)){window.dispatchEvent(new Event("pets-history-before-refresh"));setRefresh(v=>({...v,version:v.version+1,force:true}));}};
    const onVisible=()=>{if(!document.hidden)setRefresh(v=>({...v,version:v.version+1,force:false}));};
    window.addEventListener("storage",onStorage);document.addEventListener("visibilitychange",onVisible);
    return()=>{window.removeEventListener("storage",onStorage);document.removeEventListener("visibilitychange",onVisible);};
  },[]);
  if(!browser)return <p role="status">Loading this browser’s history…</p>;
  return <BrowserGenerations refresh={refresh} onRefresh={()=>setRefresh(v=>({version:v.version+1,force:true,imageRetry:v.imageRetry+1}))}/>;
}

function rowsFrom(history:ReturnType<typeof readGenerationHistory>,cache:Map<string,Result>):Row[]{
  return history.entries.map(entry=>{const result=cache.get(entry.generationId);const expiresAt=Math.min(entry.expiresAt,result?.generation?Date.parse(result.generation.expiresAt):entry.expiresAt);const parent=result?.generation?historyParent(result.generation):undefined;const createdAt=result?.generation?.createdAt?Date.parse(result.generation.createdAt):undefined;return {...entry,...(!entry.parentGenerationId&&parent?{parentGenerationId:parent.generationId,kind:parent.kind}:{}),...(entry.createdAt===undefined&&createdAt?{createdAt}:{}),...result,expiresAt,expired:expiresAt<=Date.now(),failedReads:result?.failedReads??0};});
}
function readSignal(){try{return localStorage.getItem(HISTORY_PREFIX+"refresh");}catch{return null;}}
function initialRows(){const history=readGenerationHistoryForReconciliation();return {history,rows:rowsFrom(history,new Map(history.entries.map(entry=>[entry.generationId,cachedHistoryStatus(entry)??{failedReads:0}])))};}

function BrowserGenerations({refresh,onRefresh}:{refresh:Refresh;onRefresh:()=>void}){
  const [view,setView]=useState(()=>({...initialRows(),refresh}));
  if(view.refresh!==refresh)setView({...initialRows(),refresh});
  const {history,rows}=view;
  const restoreFocus=useRef<{element:HTMLElement;href:string;summary?:boolean}|null>(null);
  const restoreExpanded=useRef<string[]>([]);
  const captureUi=useCallback(()=>{
    const active=document.activeElement;
    if(active instanceof HTMLAnchorElement&&active.closest('.my-generations'))restoreFocus.current={element:active,href:active.getAttribute('href')??''};
    else if(active instanceof HTMLElement&&active.matches('summary[data-generation-id]'))restoreFocus.current={element:active,href:withBasePath(`/generated/${active.dataset.generationId}`),summary:true};
    restoreExpanded.current=[...document.querySelectorAll<HTMLElement>('.my-generations details[open] > summary')].flatMap(summary=>summary.dataset.generationId?[summary.dataset.generationId]:[]);
  },[]);
  useEffect(()=>{
    window.addEventListener('pets-history-before-refresh',captureUi);
    return()=>window.removeEventListener('pets-history-before-refresh',captureUi);
  },[captureUi]);
  useLayoutEffect(()=>{
    const links=[...document.querySelectorAll<HTMLAnchorElement>('.my-generations a')];
    for(const id of restoreExpanded.current){
      const item=links.find(link=>link.getAttribute('href')===withBasePath(`/generated/${id}`))?.closest('.my-generations__item');
      const details=item?.querySelector('details');if(details)details.open=true;
    }
    restoreExpanded.current=[];
    const previous=restoreFocus.current;restoreFocus.current=null;
    if(!previous||previous.element.isConnected||document.activeElement!==document.body)return;
    const candidates=[...document.querySelectorAll<HTMLAnchorElement>('.my-generations a')].filter(link=>link.getAttribute('href')===previous.href);
    const visible=candidates.find(link=>!link.closest('details:not([open])'));
    const target=previous.summary?candidates[0]?.closest('.my-generations__item')?.querySelector('summary'):visible??candidates[0]?.closest('details')?.querySelector('summary');
    target?.focus({preventScroll:true});
  },[rows]);
  useEffect(()=>{
    const signal=readSignal();
    pruneHistoryStatuses(history.available?history.entries:[]);
    const cache=new Map<string,Result>(history.entries.map(entry=>{const result=cachedHistoryStatus(entry)??{failedReads:0};return [entry.generationId,refresh.force?{...result,failedReads:0}:result];}));
    pruneGenerationHistory();
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,round:AbortController|undefined;
    let firstRound=true;
    const publishRows=()=>setView(current=>current.refresh===refresh?{...current,rows:rowsFrom(history,cache)}:current);
    const update=(entry:GenerationHistoryEntry,result:Result)=>{
      if(disposed)return;
      captureUi();
      if(result.generation)rememberGenerationVersion(result.generation);
      cache.set(entry.generationId,result);cacheHistoryStatus(entry,result,signal,Date.now());publishRows();
    };
    const forceRefresh=refresh.force;
    async function poll(){
      if(disposed||document.hidden)return;
      const now=Date.now();round=new AbortController();const controller=round;
      const pending=history.entries.filter(entry=>entry.expiresAt>now&&((firstRound&&(forceRefresh||!historyStatusFresh(entry,signal,now)))||needsStatusRead(cache.get(entry.generationId))));
      firstRound=false;
      for(let start=0;start<pending.length&&!disposed;start+=3){
          await Promise.all(pending.slice(start,start+3).map(async entry=>{
            const previous=cache.get(entry.generationId);
            const requestController=new AbortController();
            const abort=()=>requestController.abort();
            controller.signal.addEventListener("abort",abort,{once:true});
            const timeout=setTimeout(abort,15000);
            try{
              const response=await fetch(withBasePath(`/api/pet-generations/${entry.generationId}`),{cache:"no-store",signal:requestController.signal});
              if(disposed)return;
              if(requestController.signal.aborted)throw Error("status_read_timed_out");
              if(response.status===404||response.status===410){update(entry,{unavailable:true,failedReads:0});return;}
              if(!response.ok)throw Error("status_unavailable");
              const body:unknown=await response.json();
              const generation=parseHistoryGeneration(body&&typeof body==="object"&&"generation"in body?body.generation:null,entry.generationId);
              if(!generation)throw Error("invalid_status_response");
              if(disposed)return;
              if(requestController.signal.aborted)throw Error("status_read_timed_out");
              update(entry,{generation,failedReads:0});
            }catch{
              update(entry,{...previous,failedReads:(previous?.failedReads??0)+1});
            }finally{clearTimeout(timeout);controller.signal.removeEventListener("abort",abort);}
          }));
        }
      if(disposed)return;
      pruneGenerationHistory();
      const updated=rowsFrom(history,cache);publishRows();
      const current=Date.now();const nextExpiry=Math.min(...updated.filter(row=>row.expiresAt>current).map(row=>row.expiresAt-current));
      const polling=updated.some(row=>row.expiresAt>current&&needsStatusRead(row));
      if(polling||Number.isFinite(nextExpiry))timer=setTimeout(()=>{void poll();},polling?Math.min(5000,Math.max(1,nextExpiry+1)):Math.max(1,nextExpiry+1));
    }
    if(history.available&&history.entries.some(entry=>entry.expiresAt>Date.now()))void poll();
    return()=>{disposed=true;round?.abort();if(timer)clearTimeout(timer);};
  },[history,refresh,captureUi]);

  if(!history.available)return <p role="alert">Browser storage is unavailable. Keep the private link shown after generation to open your pet.</p>;
  if(!rows.length)return <p>No generations saved in this browser yet. <a href={withBasePath("/generate")}>Generate a pet</a> to start.</p>;
  return <div className="my-generations">
    <Button view="outlined" onClick={onRefresh}>Refresh statuses</Button>
    <ul className="my-generations__list">
      {groupGenerationVersions(rows).slice(0,HISTORY_FAMILY_LIMIT).map(family=><FamilyRow key={family.familyId} versions={family.versions} refreshKey={refresh.imageRetry}/>)}
    </ul>
  </div>;
}

const VERSION_LABELS={initial:"Исходная генерация","base-refinement":"Изменение персонажа","base-retry":"Повтор создания персонажа",continuation:"Исправление анимаций","animation-revision":"Новая версия анимаций"};
function available(row:Row){return !row.expired&&!row.unavailable;}
function acceptedReady(row:Row){return available(row)&&row.generation?.status==="completed"&&(!row.generation.animationRevision||row.generation.animationRevision.acceptedAt!==undefined);}
function openLabel(row:Row){return row.generation?.animationRevision&&row.generation.animationRevision.acceptedAt===undefined?"Review version":acceptedReady(row)?"Open pet":"Open generation";}
function FamilyRow({versions,refreshKey}:{versions:Row[];refreshKey:number}){
  const row=versions[0];
  const [thumbnailFailures,setThumbnailFailures]=useState<{refreshKey:number;ids:string[]}>({refreshKey,ids:[]});
  if(thumbnailFailures.refreshKey!==refreshKey)setThumbnailFailures({refreshKey,ids:[]});
  const ready=versions.find(acceptedReady);
  const image=versions.find(version=>!thumbnailFailures.ids.includes(version.generationId)&&available(version)&&(version.generation?.baseUrl||version.generation?.status==="completed"));
  const name=versions.find(version=>version.generation?.pet?.displayName)?.generation?.pet?.displayName??"Pet generation";
  const otherActive=versions.slice(1).filter(version=>available(version)&&version.generation&&live(version)).length;
  return <li className="my-generations__item">
    <div className="my-generations__identity">
      <GenerationThumbnail generationId={image?.generationId??row.generationId} generation={image?.generation} expired={!image} refreshKey={refreshKey} onUnavailable={()=>{if(image)setThumbnailFailures(current=>current.ids.includes(image.generationId)?current:{...current,ids:[...current.ids,image.generationId]});}}/>
      <div className="my-generations__heading"><Text variant="subheader-2" as="h2">{name}</Text><Label theme={statusTheme(row,!available(row))}>{statusLabel(row,!available(row))}</Label></div>
    </div>
    <Text variant="body-1" color="secondary">Saved {new Date(versionTime(row)).toLocaleString()}</Text>
    {available(row)&&row.generation&&live(row)&&<p role="status">{animationRepairProgressText(row.generation.animationRepair)??`${row.generation.progress.completedSteps} / ${row.generation.progress.totalSteps} steps completed`}</p>}
    {otherActive>0&&<p>Других версий в работе: {otherActive}</p>}
    {row.failedReads>0&&available(row)&&<p role="status">Could not refresh the status. Your task is unchanged; refresh statuses or open its page.</p>}
    <p>{available(row)?`Available until ${new Date(row.expiresAt).toLocaleString()}`:"The temporary result is no longer available."}</p>
    <div className="my-generations__actions">
      {available(row)&&<Button component={HistoryNavigationLink} prefetch={false} view={acceptedReady(row)?"action":"outlined"} href={`/generated/${row.generationId}`}>{openLabel(row)}</Button>}
      {ready&&ready.generationId!==row.generationId&&<Button component={HistoryNavigationLink} prefetch={false} view="outlined" href={`/generated/${ready.generationId}`}>Открыть предыдущий готовый результат</Button>}
      {available(row)&&row.generation?.canContinue&&<Link prefetch={false} href={`/generated/${row.generationId}`}>Продолжить генерацию</Link>}
    </div>
    {versions.length>1&&<details className="my-generations__versions">
      <summary data-generation-id={row.generationId}>История версий · {versions.length}</summary>
      <ol>{versions.map(version=><li key={version.generationId}>
        <span>{VERSION_LABELS[version.kind??"initial"]}</span>
        <span>{new Date(versionTime(version)).toLocaleString()} · {statusLabel(version,!available(version))}</span>
        <span>{available(version)?`Available until ${new Date(version.expiresAt).toLocaleString()}`:"The temporary result is no longer available."}</span>
        {available(version)&&<Link prefetch={false} href={`/generated/${version.generationId}`}>Открыть версию</Link>}
      </li>)}</ol>
    </details>}
  </li>;
}
