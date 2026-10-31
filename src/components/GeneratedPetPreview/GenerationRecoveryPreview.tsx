"use client";
import {useCallback,useEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Dialog} from '@gravity-ui/uikit';
import {getPetSheet} from '@/lib/pets/types';
import {CONTINUATION_STATES,type ContinuationOptions,type ContinuationState} from '@/lib/pets/generation/continuation-model';
import './GenerationRecoveryPreview.scss';
export const RECOVERY_LABELS:Record<ContinuationState,string>={idle:'Покой',running:'Работа','running-left':'Движение влево','running-right':'Движение вправо',waving:'Приветствие',jumping:'Прыжок',waiting:'Ожидание',failed:'Неудача',review:'Размышление','look-0-157':'Направления 1–8','look-180-337':'Направления 9–16'};
type Strip=ContinuationOptions['strips'][number];
type ImageState={url?:string;error?:boolean};
const subscribeMotion=(fn:()=>void)=>{const m=matchMedia('(prefers-reduced-motion: reduce)');m.addEventListener('change',fn);return()=>m.removeEventListener('change',fn);};
const subscribeVisibility=(fn:()=>void)=>{document.addEventListener('visibilitychange',fn);return()=>document.removeEventListener('visibilitychange',fn);};
const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
const hidden=()=>document.hidden;
function useImages(urls:string[],visible:Set<string>){
 const [images,setImages]=useState<Record<string,ImageState>>({});const [attempt,setAttempt]=useState(0);
 const cache=useRef<Record<string,ImageState>>({}),inflight=useRef(new Map<string,AbortController>()),alive=useRef(true),wanted=useRef(visible);

 const pump=useRef<()=>void>(()=>{});
 useEffect(()=>{
  alive.current=true;const pending=inflight.current;
  return()=>{alive.current=false;pending.forEach(c=>c.abort());pending.clear();Object.values(cache.current).forEach(x=>{if(x.url)URL.revokeObjectURL(x.url);});cache.current={};};
 },[]);
 useEffect(()=>{
  wanted.current=visible;
  for(const [url,entry] of Object.entries(cache.current))if(!urls.includes(url)){if(entry.url)URL.revokeObjectURL(entry.url);delete cache.current[url];}
  for(const [url,controller] of inflight.current)if(!urls.includes(url)){controller.abort();inflight.current.delete(url);}
  pump.current=()=>{
   if(!alive.current)return;
   for(const url of urls){
    if(inflight.current.size>=2)break;
    if(!wanted.current.has(url)||cache.current[url]||inflight.current.has(url))continue;
    const controller=new AbortController();inflight.current.set(url,controller);
    void (async()=>{
     try{const response=await fetch(url,{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('image');const blob=await response.blob();if(controller.signal.aborted||!alive.current)return;cache.current[url]={url:URL.createObjectURL(blob)};}
     catch{if(!controller.signal.aborted&&alive.current)cache.current[url]={error:true};}
     finally{if(inflight.current.get(url)===controller)inflight.current.delete(url);if(alive.current){setImages({...cache.current});pump.current();}}
    })();
   }
  };
  pump.current();
 },[urls,visible,attempt]); // URLs, not descriptor identity, define the image cache.
 return {images,retry:(url:string)=>{delete cache.current[url];setAttempt(x=>x+1);}};
}
export function GenerationRecoveryPreview({strips,required,selected,disabled,rebuild,onChange}:{strips:Strip[];required:ContinuationState[];selected:ContinuationState[];disabled:boolean;rebuild:boolean;onChange:(s:ContinuationState[])=>void}){
 const grid=useRef<HTMLDivElement>(null),cards=useRef(new Map<string,HTMLButtonElement>()),returnFocus=useRef<HTMLElement|null>(null),close=useRef<HTMLButtonElement>(null);
 const [visible,setVisible]=useState(new Set<string>()),[inView,setInView]=useState(new Set<string>()),[detail,setDetail]=useState<ContinuationState|null>(null),[tick,setTick]=useState(0),[detailTick,setDetailTick]=useState(0),[preference,setPreference]=useState<boolean|null>(null),[detailPlaying,setDetailPlaying]=useState(false);
 const motion=useSyncExternalStore(subscribeMotion,reduced,()=>true),notVisible=useSyncExternalStore(subscribeVisibility,hidden,()=>true);
 const playing=preference??!motion;
 const urls=useMemo(()=>[...new Set(strips.flatMap(s=>s.preview?[s.preview.url]:[]))],[strips]);
 const {images,retry}=useImages(urls,visible);
 const current=strips.find(s=>s.state===detail);
 const hasAtlasFrames=strips.some(s=>s.preview?.kind==='atlas-row'&&s.preview.frames>1);
 const gridCanPlay=strips.some(s=>s.preview?.kind==='atlas-row'&&s.preview.frames>1&&inView.has(s.state)&&images[s.preview.url]?.url);
 const detailCanPlay=current?.preview?.kind==='atlas-row'&&!current.state.startsWith('look-')&&current.preview.frames>1&&Boolean(images[current.preview.url]?.url);
 useEffect(()=>{
  const nodes=grid.current?.querySelectorAll<HTMLElement>('[data-preview-url]');if(!nodes)return;
  if(typeof IntersectionObserver==='undefined'){let active=true;queueMicrotask(()=>{if(active){setVisible(v=>new Set([...v,...urls]));setInView(new Set([...nodes].map(n=>n.dataset.previewState!)));}});return()=>{active=false;};}
  const observer=new IntersectionObserver(entries=>{const additions=entries.filter(e=>e.isIntersecting).map(e=>(e.target as HTMLElement).dataset.previewUrl!);if(additions.length)setVisible(v=>new Set([...v,...additions]));},{rootMargin:'160px'});
  const playbackObserver=new IntersectionObserver(entries=>setInView(previous=>{const next=new Set(previous);for(const entry of entries){const state=(entry.target as HTMLElement).dataset.previewState!;if(entry.isIntersecting)next.add(state);else next.delete(state);}return next;}));
  nodes.forEach(n=>{observer.observe(n);playbackObserver.observe(n);});return()=>{observer.disconnect();playbackObserver.disconnect();};
 },[urls]);
 useEffect(()=>{
  if(notVisible||!(detail?detailPlaying&&detailCanPlay:playing&&gridCanPlay))return;
  const id=setInterval(()=>{if(detail)setDetailTick(t=>t+1);else setTick(t=>t+1);},140);return()=>clearInterval(id);
 },[notVisible,detail,detailPlaying,playing,detailCanPlay,gridCanPlay]);
 function select(state:ContinuationState,checked:boolean){onChange(CONTINUATION_STATES.filter(s=>s===state?checked:selected.includes(s)));}
 function open(s:Strip){setDetail(s.state);setDetailTick(0);setDetailPlaying(playing);returnFocus.current=cards.current.get(s.state)??null;if(s.preview)setVisible(v=>new Set([...v,s.preview!.url]));}
 const change=useCallback((offset:number)=>{const available=strips.filter(s=>s.preview),n=available.findIndex(s=>s.state===detail),s=available[(n+offset+available.length)%available.length];if(s){setDetail(s.state);setDetailTick(0);returnFocus.current=cards.current.get(s.state)??null;if(s.preview)setVisible(v=>new Set([...v,s.preview!.url]));}},[strips,detail]);
 useEffect(()=>{if(!detail)return;const key=(e:KeyboardEvent)=>{if(e.defaultPrevented||e.altKey||e.ctrlKey||e.metaKey)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();change(e.key==='ArrowLeft'?-1:1);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[detail,change]);
 function content(s:Strip,large=false){
  const preview=s.preview,asset=preview?images[preview.url]:undefined;
  if(!preview)return <span className="recovery-preview__empty">Изображение отсутствует</span>;
  if(asset?.error)return <span className="recovery-preview__empty">Не удалось загрузить изображение</span>;
  if(!asset?.url)return <span className="recovery-preview__empty">Загружаем изображение…</span>;
  if(preview.kind==='source-image')return <span className={large?'recovery-preview__raw-large':'recovery-preview__raw'} tabIndex={large?0:undefined} role={large?'region':undefined} aria-label={large?`Исходная полоса: ${RECOVERY_LABELS[s.state]}`:undefined} onKeyDown={large?event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight')event.stopPropagation();}:undefined}><img src={asset.url} alt={`Сохранённая полоса: ${RECOVERY_LABELS[s.state]}`}/></span>; // eslint-disable-line @next/next/no-img-element
  if(large&&s.state.startsWith('look-'))return <span className="recovery-preview__look">{Array.from({length:8},(_,frame)=><span key={frame} className="recovery-preview__sprite" style={{backgroundImage:`url(${asset.url})`,backgroundSize:'800% 1100%',backgroundPosition:`${frame/7*100}% ${preview.row/10*100}%`}}/>)}</span>;
  const sheet=getPetSheet(2),frame=(large?detailTick:tick)%preview.frames;
  return <span role="img" aria-label={RECOVERY_LABELS[s.state]} className={large?'recovery-preview__sprite recovery-preview__sprite_large':'recovery-preview__sprite'} style={{backgroundImage:`url(${asset.url})`,backgroundSize:'800% 1100%',backgroundPosition:`${frame/(sheet.columns-1)*100}% ${preview.row/(sheet.rows-1)*100}%`}}/>;
 }
 function card(s:Strip){return <article key={s.state} className={`recovery-preview__card${!rebuild&&selected.includes(s.state)?' recovery-preview__card_selected':''}`} data-preview-url={s.preview?.url} data-preview-state={s.state}>
  <button ref={node=>{if(node)cards.current.set(s.state,node);else cards.current.delete(s.state);}} type="button" className="recovery-preview__image" disabled={!s.preview} onClick={()=>open(s)} aria-label={`Просмотреть: ${RECOVERY_LABELS[s.state]}`}>{content(s)}{s.preview?.kind==='source-image'&&<small>Исходная полоса</small>}</button>
  <label className="recovery-preview__choice">{!rebuild&&<input type="checkbox" checked={selected.includes(s.state)} disabled={disabled||required.includes(s.state)} onChange={e=>select(s.state,e.target.checked)} aria-label={`Пересоздать: ${RECOVERY_LABELS[s.state]}`}/>}<span><strong>{RECOVERY_LABELS[s.state]}</strong><small>{s.status==='missing'?'Изображения нет':s.status==='invalid'?rebuild?'Исходник сохранён':'Нужно пересоздать':'Сохранено'}</small></span></label>
  {s.uncertain&&<p className="recovery-preview__warning">Прежний запрос мог быть оплачен</p>}
 </article>;}
 return <section className="recovery-preview"><div className="recovery-preview__heading"><div><h2>Сохранённые изображения</h2><p>Нажмите на изображение, чтобы рассмотреть его.</p></div>{hasAtlasFrames&&<button type="button" onClick={()=>setPreference(!playing)}>{playing?'Пауза':'Воспроизвести'}</button>}</div>
 <div ref={grid}><div className="recovery-preview__grid">{strips.filter(s=>!s.state.startsWith('look-')).map(card)}</div><h3>Направления взгляда</h3><div className="recovery-preview__gaze">{strips.filter(s=>s.state.startsWith('look-')).map(card)}</div></div>
 <Dialog open={detail!==null} onClose={()=>setDetail(null)} initialFocus={close} returnFocus={returnFocus} hasCloseButton={false} contentOverflow="auto" className="recovery-preview__dialog" aria-label={current?RECOVERY_LABELS[current.state]:'Просмотр изображения'}>
 <div className="recovery-preview__dialog-header"><h2>{current&&RECOVERY_LABELS[current.state]}</h2><button ref={close} type="button" onClick={()=>setDetail(null)} aria-label="Закрыть просмотр">×</button></div>
 <Dialog.Body>{current&&content(current,true)}<p>{current?.preview?.kind==='source-image'?'Сохранённая исходная полоса. Это не готовая анимация.':'Кадры из проверенного атласа.'}</p>{current?.preview&&images[current.preview.url]?.error&&<button onClick={()=>retry(current.preview!.url)} type="button">Повторить загрузку</button>}</Dialog.Body>
 <Dialog.Footer><div className="recovery-preview__controls"><button type="button" onClick={()=>change(-1)} aria-label="Предыдущее изображение">←</button>{current?.preview?.kind==='atlas-row'&&!current.state.startsWith('look-')&&<button type="button" onClick={()=>setDetailPlaying(v=>!v)}>{detailPlaying?'Пауза':'Воспроизвести'}</button>}<button type="button" onClick={()=>change(1)} aria-label="Следующее изображение">→</button></div>{current&&!rebuild&&<label><input type="checkbox" checked={selected.includes(current.state)} disabled={disabled||required.includes(current.state)} onChange={e=>select(current.state,e.target.checked)}/> Пересоздать: {RECOVERY_LABELS[current.state]}</label>}</Dialog.Footer>
 </Dialog></section>;
}
