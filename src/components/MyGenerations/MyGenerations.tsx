"use client";

import {useEffect,useState,useSyncExternalStore,type ComponentProps} from "react";
import Link from "next/link";
import {Button,Label,Text} from "@gravity-ui/uikit";
import {withBasePath} from "@/lib/base-path";
import {HISTORY_PREFIX,parseHistoryGeneration,readGenerationHistory,pruneGenerationHistory,type GenerationHistoryEntry} from "@/lib/pets/generation/history";
import {GenerationThumbnail} from "./GenerationThumbnail";
import {cachedHistoryStatus,cacheHistoryStatus,historyStatusFresh,pruneHistoryStatuses,type HistoryStatus} from "./history-status-cache";
import {animationRepairProgressText} from "@/lib/pets/generation/animation-repair-progress";
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
    const onStorage=(event:StorageEvent)=>{if(event.key===null||event.key.startsWith(HISTORY_PREFIX))setRefresh(v=>({...v,version:v.version+1,force:true}));};
    const onVisible=()=>{if(!document.hidden)setRefresh(v=>({...v,version:v.version+1,force:false}));};
    window.addEventListener("storage",onStorage);document.addEventListener("visibilitychange",onVisible);
    return()=>{window.removeEventListener("storage",onStorage);document.removeEventListener("visibilitychange",onVisible);};
  },[]);
  if(!browser)return <p role="status">Loading this browser’s history…</p>;
  return <BrowserGenerations refresh={refresh} onRefresh={()=>setRefresh(v=>({version:v.version+1,force:true,imageRetry:v.imageRetry+1}))}/>;
}

function rowsFrom(history:ReturnType<typeof readGenerationHistory>,cache:Map<string,Result>):Row[]{
  return history.entries.map(entry=>{const result=cache.get(entry.generationId);const expiresAt=Math.min(entry.expiresAt,result?.generation?Date.parse(result.generation.expiresAt):entry.expiresAt);return {...entry,...result,expiresAt,expired:expiresAt<=Date.now(),failedReads:result?.failedReads??0};});
}
function readSignal(){try{return localStorage.getItem(HISTORY_PREFIX+"refresh");}catch{return null;}}
function initialRows(){const history=readGenerationHistory();return {history,rows:rowsFrom(history,new Map(history.entries.map(entry=>[entry.generationId,cachedHistoryStatus(entry)??{failedReads:0}])))};}

function BrowserGenerations({refresh,onRefresh}:{refresh:Refresh;onRefresh:()=>void}){
  const [view,setView]=useState(()=>({...initialRows(),refresh}));
  if(view.refresh!==refresh)setView({...initialRows(),refresh});
  const {history,rows}=view;
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
      const updated=rowsFrom(history,cache);publishRows();
      const current=Date.now();const nextExpiry=Math.min(...updated.filter(row=>row.expiresAt>current).map(row=>row.expiresAt-current));
      const polling=updated.some(row=>row.expiresAt>current&&needsStatusRead(row));
      if(polling||Number.isFinite(nextExpiry))timer=setTimeout(()=>{void poll();},polling?5000:Math.max(1,nextExpiry+1));
    }
    if(history.available&&history.entries.some(entry=>entry.expiresAt>Date.now()))void poll();
    return()=>{disposed=true;round?.abort();if(timer)clearTimeout(timer);};
  },[history,refresh]);

  if(!history.available)return <p role="alert">Browser storage is unavailable. Keep the private link shown after generation to open your pet.</p>;
  if(!rows.length)return <p>No generations saved in this browser yet. <a href={withBasePath("/generate")}>Generate a pet</a> to start.</p>;
  return <div className="my-generations">
    <Button view="outlined" onClick={onRefresh}>Refresh statuses</Button>
    <ul className="my-generations__list">
      {rows.map(row=>{
        const expired=row.expired||row.unavailable;
        const status=statusLabel(row,Boolean(expired));
        return <li key={row.generationId} className="my-generations__item">
          <div className="my-generations__identity">
            <GenerationThumbnail generationId={row.generationId} generation={row.generation} expired={Boolean(expired)} refreshKey={refresh.imageRetry}/>
            <div className="my-generations__heading"><Text variant="subheader-2" as="h2">{row.generation?.pet?.displayName??"Pet generation"}</Text><Label theme={statusTheme(row,Boolean(expired))}>{status}</Label></div>
          </div>
          {row.generation?.continuation&&<p>{row.generation.continuation.mode === "rebuild" ? "Повторная сборка" : "Продолжение предыдущей генерации"}</p>}
          {!expired&&row.generation?.canContinue&&<p><Link prefetch={false} href={`/generated/${row.generationId}`}>Продолжить генерацию</Link></p>}
          <Text variant="body-1" color="secondary">Saved {new Date(row.savedAt).toLocaleString()}</Text>
          {!expired&&row.generation&&live(row)&&<p role="status">{animationRepairProgressText(row.generation.animationRepair) ?? `${row.generation.progress.completedSteps} / ${row.generation.progress.totalSteps} steps completed`}</p>}
          {row.failedReads>0&&!expired&&<p role="status">Could not refresh the status. Your task is unchanged; refresh statuses or open its page.</p>}
          <p>{expired?"The temporary result is no longer available.":`Available until ${new Date(row.expiresAt).toLocaleString()}`}</p>
          {!expired&&<Button component={HistoryNavigationLink} prefetch={false} view={row.generation?.status==="completed"?"action":"outlined"} href={`/generated/${row.generationId}`}>{row.generation?.status==="completed"?"Open pet":"Open generation"}</Button>}
        </li>;
      })}
    </ul>
  </div>;
}
