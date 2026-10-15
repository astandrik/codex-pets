"use client";

import {useEffect,useState,useSyncExternalStore} from "react";
import {Button,Label,Text} from "@gravity-ui/uikit";
import {withBasePath} from "@/lib/base-path";
import {HISTORY_PREFIX,parseHistoryGeneration,readGenerationHistory,pruneGenerationHistory,type GenerationHistoryEntry,type HistoryGeneration} from "@/lib/pets/generation/history";
import "./MyGenerations.scss";

type Result={generation?:HistoryGeneration; unavailable?:boolean; failedReads:number};
type Row=GenerationHistoryEntry&Result&{expired:boolean};
const subscribeToBrowser=()=>()=>{};
const LABELS={queued:"Queued",generating:"Generating",processing:"Processing",completed:"Ready",failed:"Failed"};
const live=(result?:Result)=>!result?.generation||["queued","generating","processing"].includes(result.generation.status);

function statusLabel(row:Row,expired:boolean){
  if(expired)return "Expired";
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
  const [version,setVersion]=useState(0);
  useEffect(()=>{
    const onStorage=(event:StorageEvent)=>{if(event.key===null||event.key.startsWith(HISTORY_PREFIX))setVersion(v=>v+1);};
    const onVisible=()=>{if(!document.hidden)setVersion(v=>v+1);};
    window.addEventListener("storage",onStorage);document.addEventListener("visibilitychange",onVisible);
    return()=>{window.removeEventListener("storage",onStorage);document.removeEventListener("visibilitychange",onVisible);};
  },[]);
  if(!browser)return <p role="status">Loading this browser’s history…</p>;
  return <BrowserGenerations key={version} onRefresh={()=>setVersion(v=>v+1)}/>;
}

function BrowserGenerations({onRefresh}:{onRefresh:()=>void}){
  const [history]=useState(()=>readGenerationHistory());
  const [rows,setRows]=useState<Row[]>(()=>history.entries.map(entry=>({...entry,failedReads:0,expired:entry.expiresAt<=Date.now()})));
  useEffect(()=>{
    pruneGenerationHistory();
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,round:AbortController|undefined;
    const cache=new Map<string,Result>();
    async function refresh(){
      if(disposed||document.hidden)return;
      const now=Date.now();round=new AbortController();const controller=round;
      const pending=history.entries.filter(entry=>entry.expiresAt>now&&!cache.get(entry.generationId)?.unavailable&&live(cache.get(entry.generationId))&&(cache.get(entry.generationId)?.failedReads??0)<3);
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
              if(response.status===404||response.status===410){cache.set(entry.generationId,{unavailable:true,failedReads:0});return;}
              if(!response.ok)throw Error("status_unavailable");
              const body:unknown=await response.json();
              const generation=parseHistoryGeneration(body&&typeof body==="object"&&"generation"in body?body.generation:null,entry.generationId);
              if(!generation)throw Error("invalid_status_response");
              if(disposed)return;
              if(requestController.signal.aborted)throw Error("status_read_timed_out");
              cache.set(entry.generationId,{generation,failedReads:0});
            }catch{
              if(!disposed)cache.set(entry.generationId,{...previous,failedReads:(previous?.failedReads??0)+1});
            }finally{clearTimeout(timeout);controller.signal.removeEventListener("abort",abort);}
          }));
        }
      if(disposed)return;
      const updated=history.entries.map(entry=>{const result=cache.get(entry.generationId);const expiresAt=Math.min(entry.expiresAt,result?.generation?Date.parse(result.generation.expiresAt):entry.expiresAt);return {...entry,...result,expiresAt,expired:expiresAt<=Date.now(),failedReads:result?.failedReads??0};});setRows(updated);
      const current=Date.now();const nextExpiry=Math.min(...updated.filter(row=>row.expiresAt>current).map(row=>row.expiresAt-current));
      const polling=updated.some(row=>row.expiresAt>current&&!row.unavailable&&live(row)&&row.failedReads<3);
      if(polling||Number.isFinite(nextExpiry))timer=setTimeout(()=>{void refresh();},polling?5000:Math.max(1,nextExpiry+1));
    }
    if(history.available&&history.entries.some(entry=>entry.expiresAt>Date.now()))void refresh();
    return()=>{disposed=true;round?.abort();if(timer)clearTimeout(timer);};
  },[history]);

  if(!history.available)return <p role="alert">Browser storage is unavailable. Keep the private link shown after generation to open your pet.</p>;
  if(!rows.length)return <p>No generations saved in this browser yet. <a href={withBasePath("/generate")}>Generate a pet</a> to start.</p>;
  return <div className="my-generations">
    <Button view="outlined" onClick={onRefresh}>Refresh statuses</Button>
    <ul className="my-generations__list">
      {rows.map(row=>{
        const expired=row.expired||row.unavailable;
        const status=statusLabel(row,Boolean(expired));
        return <li key={row.generationId} className="my-generations__item">
          <div className="my-generations__heading"><Text variant="subheader-2" as="h2">{row.generation?.pet?.displayName??"Pet generation"}</Text><Label theme={statusTheme(row,Boolean(expired))}>{status}</Label></div>
          <Text variant="body-1" color="secondary">Saved {new Date(row.savedAt).toLocaleString()}</Text>
          {!expired&&row.generation&&live(row)&&<p role="status">{row.generation.progress.completedSteps} / {row.generation.progress.totalSteps} steps completed</p>}
          {row.failedReads>0&&!expired&&<p role="status">Could not refresh the status. Your task is unchanged; refresh statuses or open its page.</p>}
          <p>{expired?"The temporary result is no longer available.":`Available until ${new Date(row.expiresAt).toLocaleString()}`}</p>
          {!expired&&<Button view={row.generation?.status==="completed"?"action":"outlined"} href={withBasePath(`/generated/${row.generationId}`)}>{row.generation?.status==="completed"?"Open pet":"Open generation"}</Button>}
        </li>;
      })}
    </ul>
  </div>;
}
