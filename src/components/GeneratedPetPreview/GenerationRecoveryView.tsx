"use client";
import {useEffect,useRef,useState,type CSSProperties} from 'react';
import {withBasePath} from '@/lib/base-path';
import {REGENERATION_RETRIES,type ContinuationOptions,type ContinuationState} from '@/lib/pets/generation/continuation-model';
import {GenerationRetryControl} from './GenerationRetryControl';
import {parseMaxRetriesInput} from './continuation-request';
import {GenerationRecoveryPreview} from './GenerationRecoveryPreview';
import {RECOVERY_LABELS,recoveryIssueMessage,recoveryIssueMeasurements} from './recovery-issues';
import './GenerationRecoveryView.scss';
export type RecoveryViewProps={generationId:string;options?:ContinuationOptions|null;mode:'rebuild'|'regenerate';states:ContinuationState[];busy:boolean;error:string;requestId:string|null;submitted:boolean;receiptExpired:boolean;sourceUnavailable:boolean;acceptedUrl:string;manualConfirmed:boolean;checkAttempted:boolean;maxRetries:string;legacyRetries:boolean;onMaxRetries:(value:string)=>void;onLegacyRetries:(value:boolean)=>void;onMode:(mode:'rebuild'|'regenerate')=>void;onStates:(states:ContinuationState[])=>void;onManualConfirmed:(value:boolean)=>void;onSubmit:()=>void;onCheck:(id?:string)=>void;onRefresh:()=>void;onClose:()=>void};
export function GenerationRecoveryView(p:RecoveryViewProps){
 const choices=useRef<HTMLFieldSetElement>(null),bar=useRef<HTMLDivElement>(null),jump=useRef<HTMLButtonElement>(null),link=useRef<HTMLInputElement>(null);
 const [seenContext,setSeenContext]=useState(''),[copyMessage,setCopyMessage]=useState(''),[now,setNow]=useState(()=>Date.now());
 const terminal=p.receiptExpired||p.sourceUnavailable&&!p.requestId;
 const recovering=Boolean(p.requestId),unknown=recovering&&!p.submitted;
 const locked=p.busy||p.submitted||Boolean(p.acceptedUrl)||terminal||p.sourceUnavailable;
 const modeVisible=Boolean(p.options)&&!p.submitted&&!p.sourceUnavailable&&!p.receiptExpired;
 const [manual,setManual]=useState(false);
 const needsChoice=modeVisible&&!recovering||modeVisible&&manual;
 const context=p.generationId+String(needsChoice)+String(manual);
 const gate=needsChoice&&seenContext!==context;
 const hideNewSubmit=gate&&!recovering;
 const showRetries=p.mode==='regenerate'&&Boolean(p.options?.regenerationRetries||recovering);
 const retryMaximum=recovering?REGENERATION_RETRIES.max:p.options?.regenerationRetries?.max??REGENERATION_RETRIES.max;
 const invalidRetries=showRetries&&!p.legacyRetries&&parseMaxRetriesInput(p.maxRetries,retryMaximum)===null;
 const [actionHeight,setActionHeight]=useState(100);
 const style:CSSProperties&{'--recovery-action-height':string}={'--recovery-action-height':`${actionHeight}px`};
 useEffect(()=>{
  const element=hideNewSubmit?jump.current:bar.current;if(!element)return;
  const measure=()=>setActionHeight(Math.ceil(element.getBoundingClientRect().height));
  measure();const observer=typeof ResizeObserver==='function'?new ResizeObserver(measure):undefined;
  observer?.observe(element);window.addEventListener('resize',measure);
  return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
 },[showRetries,p.acceptedUrl,p.submitted,terminal,recovering,invalidRetries,p.mode,hideNewSubmit]);
 useEffect(()=>{
  if(!p.options?.retryAt)return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);
 },[p.options?.retryAt]);
 useEffect(()=>{
  if(!needsChoice)return;
  let active=true;
  // A tall option can be read in parts; its edges need not be visible together.
  const seenEdges=new Map<Element,{top:boolean;bottom:boolean}>();
  const check=()=>{
   const modes=choices.current?.querySelectorAll<HTMLElement>('[data-recovery-mode]');
   if(!active||!modes?.length)return;
   const obstruction=hideNewSubmit?jump.current:bar.current;
   const bottom=innerHeight-(obstruction?.getBoundingClientRect().height??70)-12;
   for(const mode of modes){
    const rect=mode.getBoundingClientRect(),previous=seenEdges.get(mode);
    seenEdges.set(mode,{top:Boolean(previous?.top)||rect.top>=0&&rect.top<=bottom,bottom:Boolean(previous?.bottom)||rect.bottom>=0&&rect.bottom<=bottom});
   }
   if(innerWidth>=768||[...modes].every(mode=>seenEdges.get(mode)?.top&&seenEdges.get(mode)?.bottom))setSeenContext(context);
  };
  queueMicrotask(check);window.addEventListener('scroll',check,{passive:true});window.addEventListener('resize',check);return()=>{active=false;window.removeEventListener('scroll',check);window.removeEventListener('resize',check);};
 },[needsChoice,context,actionHeight,hideNewSubmit]);
 const count=p.states.filter(s=>!s.startsWith('look-')).length,groups=p.states.length-count;
 const summary=[count?`${count} анимац${count===1?'ия':count>=2&&count<=4?'ии':'ий'}`:'',groups?`${groups} групп${groups===1?'а':'ы'} взгляда`:''].filter(Boolean).join(' + ');
 const wait=p.mode==='rebuild'&&p.options?.retryAt?Math.max(0,Math.ceil((p.options.retryAt-now)/1000)):0;
 const submitDisabled=p.busy||Boolean(p.acceptedUrl)||terminal||p.sourceUnavailable||!p.options&&!p.submitted||p.mode==='rebuild'&&!p.submitted&&(!p.options?.canRebuild||wait>0)||p.mode==='regenerate'&&!p.submitted&&!p.states.length||unknown&&!p.manualConfirmed||!p.submitted&&invalidRetries;
 async function copy(){try{await navigator.clipboard.writeText(link.current?.value??p.acceptedUrl);setCopyMessage('Ссылка скопирована');}catch{link.current?.focus();link.current?.select();setCopyMessage('Скопируйте выделенную ссылку вручную.');}}
 const title=p.options?.character?.displayName||'Ваш питомец';
 const expiresAt=p.options?.character?.expiresAt;
 const absoluteUrl=p.acceptedUrl&&typeof window!=='undefined'?new URL(p.acceptedUrl,window.location.href).href:p.acceptedUrl;
 const currentIssues=p.options?.issues.filter(issue=>p.options?.strips.some(strip=>strip.state===issue.state&&strip.status!=='saved'))??[];
 const verifiedAtlas=Boolean(p.options?.strips.length&&p.options.strips.every(strip=>strip.status==='saved'&&strip.preview?.kind==='atlas-row'));
 return <section className="generation-recovery" lang="ru" style={style}>
 <header className="generation-recovery__identity">{p.options?.character?.baseUrl&&<img src={p.options.character.baseUrl} alt="Сохранённый образ персонажа" onError={e=>{e.currentTarget.hidden=true;}}/>}{/* eslint-disable-line @next/next/no-img-element */}<div><small>ВОССТАНОВЛЕНИЕ ГЕНЕРАЦИИ</small><h1>{title}</h1>{p.options?.character?.description&&<p>{p.options.character.description}</p>}<span>{p.acceptedUrl?'Продолжение принято':terminal?'Срок хранения истёк':recovering?'Проверяем отправленный запрос':'Сборка не завершена'}</span></div></header>
 {p.error&&<p role="alert" className="generation-recovery__notice">{p.error}</p>}
 {p.acceptedUrl?<section className="generation-recovery__accepted"><h2>Результат принят</h2><p>Сохраните приватную ссылку. Повторно отправлять запрос не нужно.</p><label>Ссылка на результат<input ref={link} readOnly value={absoluteUrl} onClick={e=>e.currentTarget.select()}/></label><button type="button" data-copy-result onClick={()=>void copy()}>Скопировать ссылку</button><p role="status">{copyMessage}</p><a href={p.acceptedUrl}>Открыть результат →</a></section>:<div className="generation-recovery__layout">
 {modeVisible&&<fieldset ref={choices} className="generation-recovery__modes" disabled={locked||recovering&&!manual}><legend>Как продолжить?</legend><label data-recovery-mode="regenerate" className={p.mode==='regenerate'?'selected':''}><input type="radio" name="continuation-mode" value="regenerate" checked={p.mode==='regenerate'} disabled={!p.options?.canRegenerate} onChange={()=>p.onMode('regenerate')}/><span><strong>Пересоздать выбранное</strong><small>1 попытка за весь набор</small></span></label><label data-recovery-mode="rebuild" className={p.mode==='rebuild'?'selected':''}><input type="radio" name="continuation-mode" value="rebuild" checked={p.mode==='rebuild'} disabled={!p.options?.canRebuild} onChange={()=>p.onMode('rebuild')}/><span><strong>Повторить сборку</strong><small>Без новой попытки · осталось {p.options?.rebuildsRemaining??0}</small></span></label></fieldset>}
 <div className="generation-recovery__images">{p.options&&!p.sourceUnavailable?<>
 {currentIssues.length?<section role="alert" className="generation-recovery__notice generation-recovery__diagnostics"><h2>Нужно исправить: {[...new Set(currentIssues.map(issue=>RECOVERY_LABELS[issue.state]))].join(', ')}</h2><ul>{currentIssues.map((issue,index)=><li key={index}><strong>{RECOVERY_LABELS[issue.state]}: </strong>{recoveryIssueMessage(issue)}<small>{recoveryIssueMeasurements(issue)}</small></li>)}</ul>{p.mode==='rebuild'&&<p>Повторная сборка не изменит исходники; ошибка может повториться.</p>}</section>:<p role="status" className="generation-recovery__notice">{verifiedAtlas?'Сохранённый атлас прошёл проверку. Подтверждённых ошибок анимаций нет.':'Точная причина ошибки пока недоступна. Проверьте сохранённые изображения и выберите, что нужно пересоздать.'}</p>}
 <GenerationRecoveryPreview strips={p.options.strips} required={p.options.requiredStates} selected={p.states} disabled={locked||unknown&&!manual} rebuild={p.mode==='rebuild'||unknown&&!manual} onChange={p.onStates} issues={currentIssues}/></>:<p className="generation-recovery__notice">{p.busy?'Проверяем сохранённые изображения…':recovering?'Сначала проверьте сохранённый запрос. Его результат может быть ещё доступен.':'Сохранённые изображения пока недоступны.'}</p>}</div>
 <aside className="generation-recovery__summary"><h2>{terminal?'Можно начать заново':recovering?'Проверить продолжение':p.mode==='rebuild'?'Повторим сборку':'Пересоздадим выбранное'}</h2>
 {recovering&&!p.submitted&&!manual?<p>Набор прошлого запроса пока неизвестен.</p>:p.mode==='regenerate'&&<><p>{summary}</p><ul>{p.states.map(s=><li key={s}>{RECOVERY_LABELS[s]}</li>)}</ul></>}
 {!terminal&&<><div ref={bar} className={`generation-recovery__submit${hideNewSubmit?' generation-recovery__submit_unseen':''}`} aria-hidden={hideNewSubmit?true:undefined} inert={hideNewSubmit}>
  {showRetries&&<GenerationRetryControl value={p.maxRetries} max={retryMaximum} disabled={locked||unknown&&!manual} legacy={p.legacyRetries} allowLegacy={unknown} onChange={p.onMaxRetries} onLegacy={p.onLegacyRetries}/>}
  <div className="generation-recovery__action"><small>{recovering?'Проверка — без новой попытки':p.mode==='rebuild'?'Без новой попытки':'1 попытка за набор'}</small>{recovering?<button type="button" className="primary" data-continuation-check disabled={p.busy} onClick={()=>p.onCheck()}>Проверить запрос</button>:<button type="button" className="primary" data-continuation-submit disabled={submitDisabled||gate} onClick={p.onSubmit}>{p.busy?'Отправляем…':p.mode==='rebuild'?wait?`Сборка через ${wait} с`:'Повторить сборку':`Пересоздать ${summary||'выбранное'}`}</button>}</div></div>
 {gate&&<button ref={jump} type="button" className={`generation-recovery__jump${recovering?' generation-recovery__jump_inline':''}`} onClick={()=>{choices.current?.scrollIntoView({block:'center'});choices.current?.querySelector<HTMLInputElement>('input:not(:disabled)')?.focus({preventScroll:true});}}>Посмотреть способы продолжения ↑</button>}
 {recovering&&(p.submitted||p.options&&manual)&&<button type="button" data-continuation-submit disabled={submitDisabled||gate} onClick={p.onSubmit}>Повторить тот же запрос</button>}
 {unknown&&p.options&&p.checkAttempted&&!p.sourceUnavailable&&<label className="generation-recovery__manual"><input type="checkbox" checked={p.manualConfirmed} disabled={p.busy} onChange={e=>{setManual(e.target.checked);p.onManualConfirmed(e.target.checked);}}/>Я выбрал тот же режим, набор и настройку автоповторов, что при первой отправке.</label>}
 {unknown&&<p>Сначала проверьте результат. Ручной повтор использует прежний UUID; другой набор может быть отклонён.</p>}
 {!p.submitted&&<button type="button" data-continuation-refresh disabled={p.busy} onClick={p.onRefresh}>Обновить изображения</button>}
 {!recovering&&<button type="button" disabled={p.busy} onClick={p.onClose}>Закрыть</button>}</>}
 {terminal&&<a href={withBasePath('/generate')}>Начать новую генерацию</a>}
 {expiresAt&&<p className="generation-recovery__terms">Сохранённые изображения доступны до <time dateTime={expiresAt}>{new Date(expiresAt).toLocaleString()}</time>. {p.mode==='rebuild'&&'Повторная сборка не продлевает этот срок.'}</p>}
 {!recovering&&!terminal&&<p className="generation-recovery__terms">{p.mode==='rebuild'?'Без новой попытки и генерации изображений. Срок хранения прежний. При необходимости подготовим имя и описание.':'Весь выбранный набор — 1 обычная попытка. Новая версия хранится 24 часа с принятия, включая очередь; прежняя сохраняется до своего срока. Базовый образ и остальные результаты переиспользуются.'}</p>}
 {p.options?.activeRequestId&&!p.requestId&&<button type="button" disabled={p.busy} onClick={()=>p.onCheck(p.options!.activeRequestId)}>Проверить продолжение в другой вкладке</button>}
 </aside></div>}
 </section>;
}
