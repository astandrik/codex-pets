"use client";

import {useCallback,useEffect,useLayoutEffect,useRef,useState,useMemo,useSyncExternalStore,useId,type ComponentProps} from "react";
import Link from "next/link";
import {Button,Dialog,Label,Text} from "@gravity-ui/uikit";
import {withBasePath} from "@/lib/base-path";
import {HISTORY_PREFIX,HISTORY_FAMILY_LIMIT,SUBMISSION_HISTORY_PREFIX,SUBMISSION_HISTORY_EVENT,parseSubmissionNotice,readSubmissionHistoryEvent,isGenerationHistoryKey,rememberGenerationVersion,rememberGenerationSubmission,historyParent,parseHistoryGeneration,readGenerationHistory,readGenerationHistoryForReconciliation,pruneGenerationHistory,type GenerationHistoryEntry} from "@/lib/pets/generation/history";
import {GenerationThumbnail} from "./GenerationThumbnail";
import {cachedHistoryStatus,cacheHistoryStatus,cacheHistorySubmission,historyStatusFresh,statusObservationFresh,HISTORY_STATUS_FRESH_MS,pruneHistoryStatuses,type HistoryStatus} from "./history-status-cache";
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
    const onStorage=(event:StorageEvent)=>{if(event.key?.startsWith(SUBMISSION_HISTORY_PREFIX))return;if(event.key===null||isGenerationHistoryKey(event.key)){window.dispatchEvent(new Event("pets-history-before-refresh"));setRefresh(v=>({...v,version:v.version+1,force:true}));}};
    const onVisible=()=>{if(!document.hidden)setRefresh(v=>({...v,version:v.version+1,force:false}));};
    window.addEventListener("storage",onStorage);document.addEventListener("visibilitychange",onVisible);
    return()=>{window.removeEventListener("storage",onStorage);document.removeEventListener("visibilitychange",onVisible);};
  },[]);
  if(!browser)return <p role="status">Loading this browser’s history…</p>;
  return <BrowserGenerations refresh={refresh} onRefresh={()=>setRefresh(v=>({version:v.version+1,force:true,imageRetry:v.imageRetry+1}))}/>;
}

function rowsFrom(history:ReturnType<typeof readGenerationHistory>,cache:Map<string,Result>):Row[]{
  return history.entries.map(entry=>{const result=cache.get(entry.generationId);const expiresAt=Math.min(entry.expiresAt,result?.generation?Date.parse(result.generation.expiresAt):entry.expiresAt);const parent=result?.generation?historyParent(result.generation):undefined;const createdAt=result?.generation?.createdAt?Date.parse(result.generation.createdAt):undefined;return {...entry,...(!entry.parentGenerationId&&parent?{parentGenerationId:parent.generationId,familyId:parent.generationId,kind:parent.kind}:{}),...(entry.createdAt===undefined&&createdAt?{createdAt}:{}),...result,submission:result?.submission??result?.generation?.submission??entry.submission,expiresAt,expired:expiresAt<=Date.now(),failedReads:result?.failedReads??0};});
}
function readSignal(){try{return localStorage.getItem(HISTORY_PREFIX+"refresh");}catch{return null;}}
function initialRows(){const history=readGenerationHistoryForReconciliation();return {history,rows:rowsFrom(history,new Map(history.entries.map(entry=>[entry.generationId,cachedHistoryStatus(entry)??{failedReads:0}])))};}

function BrowserGenerations({refresh,onRefresh}:{refresh:Refresh;onRefresh:()=>void}){
  const [view,setView]=useState(()=>({...initialRows(),refresh}));
  if(view.refresh!==refresh)setView({...initialRows(),refresh});
  const {history,rows}=view;
  const [readyOnly,setReadyOnly] = useState(false);
  const [announcement,setAnnouncement] = useState('');
  const filterRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const historyBodyRef = useRef<HTMLDivElement>(null);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  const historyReturnRef = useRef<HTMLElement | null>(null);
  const historyOpenRef = useRef(false);
  const pendingHistoryLink = useRef<string | null>(null);
  const [historyOpen,setHistoryOpen] = useState(false);
  const [selectedGenerationId,setSelectedGenerationId] = useState<string | null>(null);
  const historyTitleId = useId();
  const [clock,setClock] = useState(()=>Date.now());
  useEffect(()=>{
    const update=()=>setClock(Date.now());
    const timer=setInterval(update,60000);
    document.addEventListener('visibilitychange',update);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',update);};
  },[]);
  const focusedControl = useRef<HTMLElement | null>(null);
  const recheckFocus = useRef<{element:HTMLElement;familyId:string} | null>(null);
  const previousVisible = useRef<string[]>([]);
  const previousReadyOnly = useRef(false);
  const families = useMemo(()=>groupGenerationVersions(rows).slice(0,HISTORY_FAMILY_LIMIT),[rows]);
  const visibleIds = useMemo(()=>families.filter(family => !readyOnly || readyToSubmit(family.versions[0])).map(family => family.familyId),[families,readyOnly]);
  const selectedFamily=families.find(family=>family.versions.some(version=>version.generationId===selectedGenerationId));
  const restoreFocus=useRef<{element:HTMLElement;href:string;history?:boolean}|null>(null);
  const captureUi=useCallback(()=>{
    const active=document.activeElement;
    focusedControl.current = active instanceof HTMLElement && active.closest('.my-generations__item') ? active : null;
    if(active instanceof HTMLAnchorElement&&active.closest('.my-generations, .my-generations-history'))restoreFocus.current={element:active,href:active.getAttribute('href')??''};
    else if(active instanceof HTMLElement&&active.matches('button[data-generation-id]'))restoreFocus.current={element:active,href:withBasePath(`/generated/${active.dataset.generationId}`),history:true};
  },[]);
  const itemForVersion=useCallback((id:string)=>{
    const family=families.find(family=>family.versions.some(version=>version.generationId===id));
    return [...(listRef.current?.querySelectorAll<HTMLElement>('.my-generations__item')??[])].find(item=>item.dataset.familyId===family?.familyId);
  },[families]);
  const openHistory=useCallback((id:string,trigger?:HTMLElement)=>{
    historyReturnRef.current=trigger??itemForVersion(id)?.querySelector<HTMLButtonElement>('button[data-generation-id]')??refreshRef.current;
    recheckFocus.current=null;historyOpenRef.current=true;
    setSelectedGenerationId(id);setHistoryOpen(true);
  },[itemForVersion]);
  function closeHistory(){
    historyOpenRef.current=false;setHistoryOpen(false);pendingHistoryLink.current=null;
  }
  if(historyOpen&&!selectedFamily){
    setHistoryOpen(false);
    setAnnouncement('Запись больше не доступна в истории.');
  }
  useLayoutEffect(()=>{
    historyOpenRef.current=historyOpen;
    // UIKit restores focus after its close transition; another tab can change the target meanwhile.
    const item=selectedGenerationId?itemForVersion(selectedGenerationId):undefined;
    historyReturnRef.current=item?(item.hidden?filterRef.current:item.querySelector<HTMLButtonElement>('button[data-generation-id]')):refreshRef.current;
  },[historyOpen,selectedGenerationId,itemForVersion,visibleIds]);
  useEffect(()=>{
    window.addEventListener('pets-history-before-refresh',captureUi);
    return()=>window.removeEventListener('pets-history-before-refresh',captureUi);
  },[captureUi]);
  useEffect(()=>{
    const onFocus=(event:FocusEvent)=>{if(event.target!==filterRef.current)recheckFocus.current=null;};
    const onBlur=()=>{recheckFocus.current=null;};
    document.addEventListener('focusin',onFocus);window.addEventListener('blur',onBlur);
    return()=>{document.removeEventListener('focusin',onFocus);window.removeEventListener('blur',onBlur);};
  },[]);
  useLayoutEffect(()=>{
    const hiddenBySubmission = readyOnly && previousReadyOnly.current && previousVisible.current.some(id => !visibleIds.includes(id) && families.some(family => family.familyId === id && family.versions[0].submission));
    previousVisible.current = visibleIds;
    previousReadyOnly.current = readyOnly;
    if (hiddenBySubmission) setAnnouncement('Отправлено на ревью. Запись скрыта фильтром «Готовы к отправке».');
    if(historyOpenRef.current){
      focusedControl.current=null;recheckFocus.current=null;
      const previous=restoreFocus.current;restoreFocus.current=null;
      if(previous&&!previous.history&&(document.activeElement===document.body||document.activeElement===previous.element)&&(!previous.element.isConnected||previous.element.getAttribute('href')!==previous.href)){
        const link=[...(historyBodyRef.current?.querySelectorAll<HTMLAnchorElement>('a')??[])].find(link=>link.getAttribute('href')===previous.href);
        (link??historyHeadingRef.current)?.focus({preventScroll:true});
      }
      return;
    }
    const focused = focusedControl.current;
    focusedControl.current = null;
    if (readyOnly && focused && (!focused.isConnected || focused.closest('[hidden]')) && (document.activeElement === focused || document.activeElement === document.body)) {
      const row=focused.closest<HTMLElement>('.my-generations__item');
      const family=families.find(item=>item.versions[0].generationId===row?.dataset.historyVersion);
      recheckFocus.current=family?.versions[0].checking&&refreshableSubmission(family.versions[0])?{element:focused,familyId:family.familyId}:null;
      filterRef.current?.focus({preventScroll:true});
    }
    const pendingFocus=recheckFocus.current;
    if(pendingFocus){
      const family=families.find(item=>item.familyId===pendingFocus.familyId);
      if(!readyOnly||!family||!pendingFocus.element.isConnected)recheckFocus.current=null;
      else if(visibleIds.includes(family.familyId)){
        recheckFocus.current=null;
        if(document.activeElement===filterRef.current&&!pendingFocus.element.closest('[hidden]'))pendingFocus.element.focus({preventScroll:true});
      }else if(!family.versions[0].checking||!refreshableSubmission(family.versions[0]))recheckFocus.current=null;
    }
    const previous=restoreFocus.current;restoreFocus.current=null;
    if(!previous)return;
    const active=document.activeElement;
    if(active!==document.body&&active!==previous.element)return;
    if(previous.element.isConnected&&(previous.history||previous.element.getAttribute('href')===previous.href))return;
    const versionId=previous.href.split('/').at(-1)??'';
    const item=itemForVersion(versionId);
    if(!item){refreshRef.current?.focus({preventScroll:true});return;}
    if(item.hidden){filterRef.current?.focus({preventScroll:true});return;}
    const target=previous.history?item.querySelector<HTMLButtonElement>('button[data-generation-id]'):[...item.querySelectorAll<HTMLAnchorElement>('a')].find(link=>link.getAttribute('href')===previous.href);
    if(target){target.focus({preventScroll:true});return;}
    // Keep a focused capability pointing at its original version when a new version replaces it.
    if(rows.some(row=>row.generationId===versionId&&available(row))){
      pendingHistoryLink.current=previous.href;openHistory(versionId);
    }else item.querySelector<HTMLButtonElement>('button[data-generation-id]')?.focus({preventScroll:true});
  },[rows,readyOnly,families,visibleIds,itemForVersion,openHistory]);
  useEffect(()=>{
    const signal=readSignal();
    pruneHistoryStatuses(history.available?history.entries:[]);
    const cache=new Map<string,Result>(history.entries.map(entry=>{const result=cachedHistoryStatus(entry)??{failedReads:0};return [entry.generationId,refresh.force?{...result,failedReads:0}:result];}));
    pruneGenerationHistory();
    let disposed=false,timer:ReturnType<typeof setTimeout>|undefined,round:AbortController|undefined;
    let firstRound=true;
    const publishRows=()=>{
      captureUi();
      setView(current=>current.refresh===refresh?{...current,rows:rowsFrom(history,cache)}:current);
    };
    const update=(entry:GenerationHistoryEntry,result:Result)=>{
      if(disposed)return;
      if(result.generation){
        const deadline=Math.min(entry.expiresAt,Date.parse(result.generation.expiresAt));
        if(result.generation.submission&&deadline<=Date.now()){
          // A GET may finish after expiry; retain its receipt without admitting an expired version.
          rememberGenerationSubmission(entry.generationId,new Date(deadline).toISOString(),result.generation.submission);
        }else rememberGenerationVersion(result.generation);
      }
      const submission = result.submission ?? result.generation?.submission ?? cache.get(entry.generationId)?.submission ?? cachedHistoryStatus(entry)?.submission;
      const merged = {...result,checkedAt:Date.now(),checking:false,...(submission?{submission}:{})};
      cache.set(entry.generationId,merged);cacheHistoryStatus(entry,merged,signal,Date.now());publishRows();
    };
    const receiveSubmission = (notice:ReturnType<typeof parseSubmissionNotice>) => {
      if (!notice) return;
      const entry = history.entries.find(entry => entry.generationId === notice.generationId);
      if (!entry) return;
      const previous = cache.get(entry.generationId) ?? {failedReads:0};
      if (previous.submission) return;
      cache.set(entry.generationId,{...previous,submission:notice.submission});
      cacheHistorySubmission(entry,notice.submission);
      publishRows();
    };
    const onSubmission = (event:Event) => receiveSubmission(parseSubmissionNotice((event as CustomEvent).detail));
    const onSubmissionStorage = (event:StorageEvent) => receiveSubmission(readSubmissionHistoryEvent(event.key,event.newValue));
    window.addEventListener(SUBMISSION_HISTORY_EVENT,onSubmission);
    window.addEventListener('storage',onSubmissionStorage);
    const forceRefresh=refresh.force;
    async function poll(){
      if(disposed||document.hidden)return;
      const now=Date.now();round=new AbortController();const controller=round;
      const pending=rowsFrom(history,cache).filter(row=>!row.expired&&((firstRound&&(forceRefresh||!historyStatusFresh(row,signal,now)))||needsStatusRead(row)||(refreshableSubmission(row)&&!statusObservationFresh(row,now))));
      firstRound=false;
      if(pending.length){
        for(const entry of pending)cache.set(entry.generationId,{...(cache.get(entry.generationId)??{failedReads:0}),checking:true});
        publishRows();
      }
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
      const nextSubmissionCheck=Math.min(...updated.filter(refreshableSubmission).map(row=>Math.max(1,(row.checkedAt??0)+HISTORY_STATUS_FRESH_MS-current)));
      const nextCheck=Math.min(polling?5000:Infinity,Math.max(1,nextExpiry+1),nextSubmissionCheck);
      if(Number.isFinite(nextCheck))timer=setTimeout(()=>{void poll();},nextCheck);
    }
    if(history.available&&history.entries.some(entry=>entry.expiresAt>Date.now()))void poll();
    return()=>{disposed=true;round?.abort();if(timer)clearTimeout(timer);window.removeEventListener(SUBMISSION_HISTORY_EVENT,onSubmission);window.removeEventListener('storage',onSubmissionStorage);};
  },[history,refresh,captureUi]);

  return <div className="my-generations">
    <div className="my-generations__toolbar">
      <Button ref={refreshRef} view="outlined" onClick={onRefresh}>Refresh statuses</Button>
      {history.available&&rows.length>0&&<label className="my-generations__filter"><input ref={filterRef} type="checkbox" checked={readyOnly} onChange={event=>{recheckFocus.current=null;setAnnouncement('');setReadyOnly(event.target.checked);}}/>Готовы к отправке</label>}
    </div>
    <p className="my-generations__announcement" role="status" aria-live="polite">{announcement}</p>
    {!history.available?<p role="alert">Browser storage is unavailable. Keep the private link shown after generation to open your pet.</p>:!rows.length?<p>No generations saved in this browser yet. <a href={withBasePath("/generate")}>Generate a pet</a> to start.</p>:<>
      {readyOnly&&!visibleIds.length&&<p>Нет готовых текущих версий, ожидающих отправки.</p>}
      <ul ref={listRef} className="my-generations__list">
        {families.map(family=><FamilyRow key={family.familyId} familyId={family.familyId} versions={family.versions} refreshKey={refresh.imageRetry} hidden={!visibleIds.includes(family.familyId)} now={clock} onHistory={openHistory}/>)}
      </ul>
    </>}
    <Dialog open={historyOpen&&Boolean(selectedFamily)} onClose={closeHistory} returnFocus={historyReturnRef} initialFocus={historyHeadingRef} disableBodyScrollLock={!historyOpen} contentOverflow="auto" className="my-generations-history" modalClassName="my-generations-history-modal" aria-labelledby={historyTitleId} onTransitionInComplete={()=>{
      const href=pendingHistoryLink.current;pendingHistoryLink.current=null;
      if(href)[...(historyBodyRef.current?.querySelectorAll<HTMLAnchorElement>('a')??[])].find(link=>link.getAttribute('href')===href)?.focus({preventScroll:true});
    }}>
      <Dialog.Header caption={<h2 id={historyTitleId} ref={historyHeadingRef} tabIndex={-1}>{selectedFamily&&selectedFamily.versions.length>1?`История версий · ${selectedFamily.versions.length}`:'Даты и детали'}</h2>}/>
      <Dialog.Body><div ref={historyBodyRef}>
        <ol className="my-generations-history__versions">{selectedFamily?.versions.map((version,index)=><li key={version.generationId} data-history-version={version.generationId}>
          <strong>{VERSION_LABELS[version.kind??'initial']}{index===0?' · Текущая версия':''}</strong>
          <span>{version.generation?.pet?.displayName??'Pet generation'}</span>
          <Label theme={statusTheme(version,!available(version))}>{statusLabel(version,!available(version))}</Label>
          <SubmissionStatus row={version} showDate/>
          <span>Saved {new Date(versionTime(version)).toLocaleString()}</span>
          <span>Available until {new Date(version.expiresAt).toLocaleString()}</span>
          {!available(version)&&<span>The temporary result is no longer available.</span>}
          {available(version)&&<Link prefetch={false} href={`/generated/${version.generationId}`}>Открыть версию</Link>}
        </li>)}</ol>
      </div></Dialog.Body>
      <Dialog.Footer><Button onClick={closeHistory}>Закрыть</Button></Dialog.Footer>
    </Dialog>
  </div>;
}

const VERSION_LABELS={initial:"Исходная генерация","base-refinement":"Изменение персонажа","base-retry":"Повтор создания персонажа",continuation:"Исправление анимаций","animation-revision":"Новая версия анимаций"};
function available(row:Row){return !row.expired&&!row.unavailable;}
function acceptedReady(row:Row){return available(row)&&row.generation?.status==="completed"&&(!row.generation.animationRevision||row.generation.animationRevision.acceptedAt!==undefined);}
function openLabel(row:Row){return row.generation?.animationRevision&&row.generation.animationRevision.acceptedAt===undefined?"Review version":acceptedReady(row)?"Open pet":"Open generation";}
function FamilyRow({familyId,versions,refreshKey,hidden,now,onHistory}:{familyId:string;versions:Row[];refreshKey:number;hidden:boolean;now:number;onHistory:(id:string,trigger:HTMLElement)=>void}){
  const row=versions[0];
  const [thumbnailFailures,setThumbnailFailures]=useState<{refreshKey:number;ids:string[]}>({refreshKey,ids:[]});
  if(thumbnailFailures.refreshKey!==refreshKey)setThumbnailFailures({refreshKey,ids:[]});
  const ready=versions.find(acceptedReady);
  const image=versions.find(version=>!thumbnailFailures.ids.includes(version.generationId)&&available(version)&&(version.generation?.baseUrl||version.generation?.status==="completed"));
  const name=versions.find(version=>version.generation?.pet?.displayName)?.generation?.pet?.displayName??"Pet generation";
  const otherActive=versions.slice(1).filter(version=>available(version)&&version.generation&&live(version)).length;
  return <li className="my-generations__item" data-history-version={row.generationId} data-family-id={familyId} hidden={hidden}>
    <div className="my-generations__identity">
      <GenerationThumbnail generationId={image?.generationId??row.generationId} generation={image?.generation} expired={!image} refreshKey={refreshKey} onUnavailable={()=>{if(image)setThumbnailFailures(current=>current.ids.includes(image.generationId)?current:{...current,ids:[...current.ids,image.generationId]});}}/>
      <div className="my-generations__heading"><Text variant="subheader-2" as="h2">{name}</Text></div>
    </div>
    <Label theme={statusTheme(row,!available(row))}>{statusLabel(row,!available(row))}</Label>
    <SubmissionStatus row={row}/>
    {!row.submission && versions.slice(1).some(version=>version.submission) && <p>Ранее отправлена другая версия</p>}

    {available(row)&&row.generation&&live(row)&&<p role="status">{animationRepairProgressText(row.generation.animationRepair)??`${row.generation.progress.completedSteps} / ${row.generation.progress.totalSteps} steps completed`}</p>}
    {otherActive>0&&<p>Других версий в работе: {otherActive}</p>}
    {row.failedReads>0&&available(row)&&<p role="status">Could not refresh the status. Your task is unchanged; refresh statuses or open its page.</p>}
    <p className="my-generations__expiry">{available(row)?remainingTime(row.expiresAt,now):"The temporary result is no longer available."}</p>
    <div className="my-generations__actions">
      {available(row)&&<Button component={HistoryNavigationLink} prefetch={false} view={acceptedReady(row)?"action":"outlined"} href={`/generated/${row.generationId}`}>{openLabel(row)}</Button>}
      {ready&&ready.generationId!==row.generationId&&<Button className="my-generations__previous" component={HistoryNavigationLink} prefetch={false} view="outlined" href={`/generated/${ready.generationId}`}>Открыть предыдущий готовый результат</Button>}
    </div>
    <Button view="flat" className="my-generations__history-trigger" data-generation-id={row.generationId} aria-haspopup="dialog" onClick={event=>onHistory(row.generationId,event.currentTarget)}>{versions.length>1?`История версий · ${versions.length}`:'Даты и детали'}</Button>
  </li>;
}

function refreshableSubmission(row:Row):boolean {
  return acceptedReady(row) && row.failedReads === 0 && !row.submission;
}
function readyToSubmit(row:Row):boolean {
  return refreshableSubmission(row) && statusObservationFresh(row,Date.now());
}
function SubmissionStatus({row,showDate=false}:{row:Row;showDate?:boolean}) {
  if (row.submission) return <div className="my-generations__submission"><Label theme="info">Отправлен на ревью</Label>{showDate&&<span>{new Date(row.submission.submittedAt).toLocaleString()}</span>}</div>;
  if (readyToSubmit(row)) return <Label theme="warning">Не отправлен</Label>;
  if (row.expired || row.unavailable || row.failedReads > 0 || !row.generation || refreshableSubmission(row)) return <Label theme="unknown">Отправка неизвестна</Label>;
  return null;
}

function remainingTime(expiresAt:number,now:number){
  const minutes=Math.max(0,Math.floor((expiresAt-now)/60000));
  if(minutes>=60)return `Доступен ещё ${Math.floor(minutes/60)} ч`;
  if(minutes>0)return `Доступен ещё ${minutes} мин`;
  return 'Доступен ещё менее минуты';
}
