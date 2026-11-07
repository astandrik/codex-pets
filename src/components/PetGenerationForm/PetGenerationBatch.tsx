"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {Button} from '@gravity-ui/uikit';
import {withBasePath} from '@/lib/base-path';
import {BATCH_LIMIT,BATCH_LOCK,batchSnapshot,assertBatchSnapshot,type ImageBatch,type BatchItem,type BatchSnapshot} from './batch-model';
import {openBatchStore,type BatchStore} from './batch-store';
import {runBatch} from './batch-runner';
import {needsHistorySync,synchronizeBatchHistory} from './batch-history';
import {prepareReferenceImage,ReferenceImageError} from './prepare-reference-image';
import './PetGenerationBatch.scss';

async function thumbnail(url:string):Promise<Blob> {
  const image=new Image();image.src=url;await image.decode();
  if(image.naturalWidth*image.naturalHeight>25_000_000)throw new Error('Изображение больше 25 миллионов пикселей.');
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const context=canvas.getContext('2d');if(!context)throw Error('Не удалось подготовить превью.');
  const scale=Math.min(128/image.naturalWidth,128/image.naturalHeight);
  const width=image.naturalWidth*scale,height=image.naturalHeight*scale;
  context.drawImage(image,(128-width)/2,(128-height)/2,width,height);
  return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Не удалось сохранить превью.')),'image/webp',0.8));
}
function Preview({store,id}:{store:BatchStore;id:string}) {
  const [url,setUrl]=useState<string>();
  useEffect(()=>{let gone=false,created:string|undefined;void store.readPreview(id).then(blob=>{
    if(blob&&!gone){created=URL.createObjectURL(blob);setUrl(created);}
  }).catch(()=>{});return()=>{gone=true;if(created)URL.revokeObjectURL(created);};},[store,id]);
  // Local, bounded thumbnails must not be sent through the server image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return url?<img src={url} alt="" width={80} height={80} loading="lazy"/>:<span className="generation-batch__placeholder" aria-hidden="true"/>;
}
export function PetGenerationBatch({enabled,admissionAvailable=true,onAvailabilityChange}:{enabled:boolean;admissionAvailable?:boolean;onAvailabilityChange?:(available:boolean)=>void}) {
  const [store,setStore]=useState<BatchStore>(),[batch,setBatch]=useState<ImageBatch|null>(null);
  const [notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[otherTab,setOtherTab]=useState(false),[supported,setSupported]=useState(false),[readFailed,setReadFailed]=useState(false);
  const [confirmDelete,setConfirmDelete]=useState<BatchSnapshot|null>(null),[incomplete,setIncomplete]=useState(false),[now,setNow]=useState(0);
  const mounted=useRef(true),controller=useRef<AbortController|null>(null),working=useRef(false),refreshing=useRef(false);
  const historyAttempts=useRef(new Set<string>());
  const refresh=useCallback(async()=>{
    if(!store||refreshing.current)return;
    refreshing.current=true;
    try {
      let value=await store.read();const at=Date.now();
      const pending=value?.items.filter(item=>needsHistorySync(item)&&!historyAttempts.current.has(item.id)).map(item=>item.id)??[];
      if(value&&(value.expiresAt<=at||pending.length)&&!working.current) {
        await navigator.locks.request(BATCH_LOCK,{ifAvailable:true},async lock=>{if(lock){
          await store.maintain(at);
          if(value&&pending.length){pending.forEach(id=>historyAttempts.current.add(id));await synchronizeBatchHistory(store,value.id,at,undefined,pending);}
        }});
        value=await store.read();
      }
      const locks=await navigator.locks.query();
      if(mounted.current){setReadFailed(false);setBatch(value);setNow(at);setOtherTab(!working.current&&locks.held?.some(lock=>lock.name===BATCH_LOCK)===true);onAvailabilityChange?.(Boolean(value));}
    }catch{if(mounted.current){setReadFailed(true);setNotice('Не удалось прочитать пакет. Данные восстановления не заменены.');}}
    finally{refreshing.current=false;}
  },[store,onAvailabilityChange]);
  useEffect(()=>{
    mounted.current=true;
    void Promise.resolve().then(async()=>{
      if(!globalThis.indexedDB||!navigator.locks){if(mounted.current)setNotice('Этот браузер не поддерживает безопасное продолжение пакета. Используйте одиночную форму.');return;}
      try {const value=await openBatchStore();if(mounted.current){setSupported(true);setStore(value);}}
      catch {if(mounted.current)setNotice('Хранилище браузера недоступно. Используйте одиночную форму.');}
    });
    return()=>{mounted.current=false;controller.current?.abort();};
  },[]);
  useEffect(()=>{const initial=setTimeout(()=>void refresh(),0),timer=setInterval(()=>void refresh(),2000);return()=>{clearTimeout(initial);clearInterval(timer);};},[refresh]);
  useEffect(()=>{if(!enabled||!admissionAvailable)controller.current?.abort();},[enabled,admissionAvailable]);
  async function locked(action:(storage:BatchStore,signal:AbortSignal)=>Promise<void>) {
    if(!store||working.current)return;
    working.current=true;setBusy(true);setNotice('');controller.current=new AbortController();
    try {
      await navigator.locks.request(BATCH_LOCK,{ifAvailable:true},async lock=>{
        if(!lock){setNotice('Пакет открыт для отправки в другой вкладке.');return;}
        await action(store,controller.current!.signal);
      });
    }catch(error){if(mounted.current)setNotice(error instanceof Error?error.message:'Не удалось сохранить пакет.');}
    finally{working.current=false;if(mounted.current){setBusy(false);await refresh();}}
  }
  async function select(files:File[]) {
    if(!enabled||!files.length)return;
    if((batch?.items.length??0)+files.length>BATCH_LIMIT){setNotice('Можно выбрать до 100 изображений. Сократите выбор: файлы не были добавлены.');return;}
    let expected=batchSnapshot(batch);
    await locked(async(storage,signal)=>{
      await storage.maintain(Date.now());
      const current=await storage.read();assertBatchSnapshot(current,expected);
      if(current?.started)throw Error('Сначала удалите завершённый или приостановленный пакет.');
      if((current?.items.length??0)+files.length>BATCH_LIMIT)throw Error('Можно выбрать до 100 изображений.');
      for(const source of files) {
        if(signal.aborted)break;
        const item:BatchItem={id:crypto.randomUUID(),requestId:crypto.randomUUID(),name:source.name,type:source.type,state:'ready'};
        let prepared:Awaited<ReturnType<typeof prepareReferenceImage>>|undefined;
        let preview:Blob|undefined;
        try{prepared=await prepareReferenceImage(source,signal);preview=await thumbnail(prepared.url);}
        catch(error){
          if(signal.aborted)break;
          item.state='invalid';item.error=error instanceof ReferenceImageError&&error.code==='too_large'?'Изображение больше 5 МиБ.':error instanceof Error?error.message:'Не удалось прочитать изображение.';
        }
        try {
          if(signal.aborted)break;
          await storage.add(item,item.state==='ready'?prepared?.file:undefined,preview,expected);
          expected=batchSnapshot(await storage.read());
          await refresh();
        }catch{setIncomplete(true);setNotice('Не хватило места или сохранение прервано. В списке только сохранённые файлы. Уменьшите пакет.');break;}
        finally{if(prepared)URL.revokeObjectURL(prepared.url);}
      }
    });
  }
  async function start() {
    if(!enabled||!admissionAvailable||incomplete)return;
    const expected=batchSnapshot(batch);
    await locked(async(storage,signal)=>{
      const value=await storage.read();assertBatchSnapshot(value,expected);if(!value)return;
      if(value.expiresAt<=Date.now())throw Error('Срок хранения пакета истёк. Удалите его перед новым запуском.');
      await runBatch(storage,{expected,signal,changed:()=>{void refresh();}});
    });
  }
  async function remove(id:string){const expected=batchSnapshot(batch);await locked(async storage=>{
    const value=await storage.read();if(!value||value.started)return;
    await storage.update(value.id,b=>{assertBatchSnapshot(b,expected);return {...b,items:b.items.filter(x=>x.id!==id)};},{removeFiles:[id],removePreviews:[id]});
  });}
  async function clear(){const expected=confirmDelete;if(!expected)return;try{await locked(async storage=>{await storage.clear(expected);setIncomplete(false);});}finally{setConfirmDelete(null);}}
  function transfer(event:React.ClipboardEvent|React.DragEvent) {
    const data='clipboardData' in event?event.clipboardData:event.dataTransfer;
    const files=Array.from(data.files);
    if(!files.length)for(const item of Array.from(data.items)) {
      const file=item.kind==='file'?item.getAsFile():null;
      if(file)files.push(file);
    }
    if(!files.length)return;
    event.preventDefault();if(!busy&&!otherTab&&!batch?.started)void select(files);
  }
  const accepted=batch?.items.filter(x=>x.receipt).length??0;
  const ready=batch?.items.filter(x=>x.state==='ready').length??0;
  const total=batch?.total??ready;
  const remaining=batch?.items.some(x=>['ready','sending','uncertain'].includes(x.state));
  return <section className="generation-batch" onPaste={transfer} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={transfer} aria-label="Пакет изображений">
    <h1>Создать питомцев из изображений</h1>
    <p>До 100 PNG, JPEG или WebP, не больше 5 МиБ каждый. Одна картинка — одна отдельная генерация с ручной проверкой основы.</p>
    <p>Каждая принятая задача расходует квоту отдельно, даже если результат не подойдёт.</p>
    <p>Неотправленные изображения хранятся семь дней в этом браузере. После закрытия страницы продолжите отправку кнопкой. Очистка данных браузера удалит локальный пакет.</p>
    {notice&&<p role="alert">{notice}</p>}
    {!enabled&&<p role="status">Генерации сейчас отключены.</p>}
    {!admissionAvailable&&<p role="status">Приём новых задач временно недоступен.</p>}
    {otherTab&&<p role="status">Пакет отправляется в другой вкладке.</p>}
    {!batch?.started&&<label className="generation-batch__picker">Выбрать изображения
      <input aria-label="Изображения для пакета" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={!supported||!store||!enabled||busy||otherTab} onChange={e=>{const files=Array.from(e.currentTarget.files??[]);e.currentTarget.value='';void select(files);}}/>
    </label>}
    <div className="generation-batch__progress" aria-live="polite">
      {batch?.started?<strong>Принято {accepted} из {total}</strong>:<strong>Выбрано {batch?.items.length??0} · Готово к отправке {ready}</strong>}
      {busy?<span>{batch?.started?batch.message:'Читаем и сохраняем изображения…'}</span>:<span>{batch?.started&&remaining&&!otherTab?'Пакет приостановлен. ':''}{batch?.message}</span>}
    </div>
    <div className="generation-batch__actions">
      {busy?<Button onClick={()=>controller.current?.abort()}>Пауза после текущей операции</Button>:<Button view="action" disabled={!enabled||!admissionAvailable||!store||otherTab||incomplete||!remaining} onClick={()=>void start()}>{batch?.started?'Продолжить пакет':`Создать ${ready} питомцев`}</Button>}
      {incomplete&&<Button onClick={()=>setIncomplete(false)}>Оставить только сохранённые файлы</Button>}
      {batch?.items.some(needsHistorySync)&&<Button disabled={busy||otherTab} onClick={()=>void locked(async storage=>{await synchronizeBatchHistory(storage,batch.id);})}>Повторить сохранение истории</Button>}
      {(batch||readFailed)&&<Button disabled={!store||!batch||busy||otherTab} onClick={()=>setConfirmDelete(batchSnapshot(batch))}>Удалить локальный пакет</Button>}
    </div>
    {confirmDelete&&<div role="alert" className="generation-batch__confirm"><p>Удалить файлы и ссылки из этого пакета? Принятые сервером задачи продолжат работу. My generations хранит только последние 50 питомцев.</p><Button view="outlined-danger" onClick={()=>void clear()}>Удалить пакет</Button><Button onClick={()=>setConfirmDelete(null)}>Отмена</Button></div>}
    <ol className="generation-batch__list">{batch?.items.map(item=><li key={item.id}>
      {store&&<Preview store={store} id={item.id}/>}
      <div className="generation-batch__item"><strong>{item.name}</strong><span>{item.receipt?'Принято':item.state==='ready'?'Ожидает отправки':item.state==='sending'?'Отправляется':item.state==='uncertain'?'Отправка не подтверждена':'Ошибка изображения'}</span>
        {item.error&&<span>{item.error}</span>}
        {item.historyWarning&&<span>Ссылку не удалось сохранить в My generations. Она доступна здесь.</span>}
        {item.receipt&&(Date.parse(item.receipt.expiresAt)>now?<a href={withBasePath('/generated/'+item.receipt.generationId)}>Открыть</a>:<span>Срок результата истёк</span>)}
      </div>
      {!batch.started&&!busy&&!otherTab&&<Button aria-label={`Убрать ${item.name}`} onClick={()=>void remove(item.id)}>Убрать</Button>}
    </li>)}</ol>
    <a href={withBasePath('/my-generations')}>My generations</a>
  </section>;
}
