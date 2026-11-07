import {withBasePath} from '@/lib/base-path';
import {reconcileGenerationHistoryReceipt} from '@/lib/pets/generation/history';
import {assertBatchSnapshot,readGeneration,REQUEST_LIFETIME,type ImageBatch,type BatchItem,type BatchSnapshot} from './batch-model';
import type {BatchStore} from './batch-store';
import {synchronizeBatchHistory} from './batch-history';

const pauseErrors:Record<string,string>={
  budget_exhausted:'Достигнут лимит расходов сервиса.',rate_limited:'Достигнут дневной лимит генераций.',
  generation_paused:'Сервис приостановил генерации.',generation_disabled:'Генерации отключены.',
  generation_not_configured:'Сервис генерации не настроен. Продолжите после восстановления сервиса.',
  client_ip_unavailable:'Сервис не смог определить адрес запроса. Продолжите позже.',
  generation_review_disabled:'Создание персонажей временно отключено.',generation_expired:'Срок проверки запроса истёк. Новый запрос автоматически не создаётся.',
};
function unknown(generation:ReturnType<typeof readGeneration>) {
  return ['outcome_unknown','generation_paused'].includes(generation.error?.code??'') || (generation.status==='failed'&&(!generation.error||generation.error.code==='generation_unavailable'));
}
type Options={expected:BatchSnapshot;signal:AbortSignal;request?:(url:string,init?:RequestInit)=>Promise<Response>;now?:()=>number;wait?:(ms:number)=>Promise<void>;remember?:typeof reconcileGenerationHistoryReceipt;changed?:()=>void};
function sleep(ms:number,signal:AbortSignal) {
  return new Promise<void>(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,ms);signal.addEventListener('abort',finish,{once:true});if(signal.aborted)finish();
  });
}
export async function runBatch(store:BatchStore,options:Options):Promise<void> {
  const request=options.request??fetch,now=options.now??Date.now,wait=options.wait??(ms=>sleep(ms,options.signal));
  const remember=options.remember??reconcileGenerationHistoryReceipt;
  if(options.expected.id===null)return;
  const id:string=options.expected.id;
  let batch:ImageBatch|null,backoff=0;
  async function update(change:(b:ImageBatch)=>void,removeFiles?:string[]) {
    await store.update(id,b=>{change(b);return b;},{removeFiles});options.changed?.();
  }
  async function message(text:string){await update(b=>{b.message=text;});}
  async function patch(itemId:string,change:Partial<BatchItem>,remove=false) {
    await update(b=>{const item=b.items.find(x=>x.id===itemId);if(!item)throw Error('Пакет изменился.');Object.assign(item,change);},remove?[itemId]:undefined);
  }
  async function jsonRequest(url:string,init?:RequestInit) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30_000);
    try {const response=await request(url,{...init,signal:controller.signal,cache:'no-store'});return {response,value:await response.json()};}
    finally {clearTimeout(timer);}
  }
  await update(b=>{assertBatchSnapshot(b,options.expected);if(!b.started)b.total=b.items.filter(x=>x.state!=='invalid').length;b.started=true;b.message=undefined;});
  while(!options.signal.aborted) {
    batch=await store.read();if(!batch||batch.id!==id)return;
    if(batch.expiresAt<=now()){await message('Срок хранения пакета истёк.');return;}
    // Only an explicitly uncertain accepted generation needs a status check on resume.
    const blocked=batch.items.find(x=>x.blocked);
    if(blocked) {
      const receipt=blocked.receipt;
      if(!receipt){await message('Отсутствует подтверждение принятой задачи.');return;}
      if(Date.parse(receipt.expiresAt)>now()){
        try {
          const {response,value}=await jsonRequest(withBasePath('/api/pet-generations/'+receipt.generationId));
          if(!response.ok)throw Error('status');
          const generation=readGeneration(value);
          if(generation.generationId!==receipt.generationId)throw Error('identity');
          if(unknown(generation)){await message('Исход одной генерации неизвестен. Отправка пакета остановлена.');return;}
        } catch {await message('Не удалось проверить принятую задачу. Продолжите после восстановления связи.');return;}
      }
      await patch(blocked.id,{blocked:false});continue;
    }
    const uncertain=batch.items.find(x=>x.state==='sending'||x.state==='uncertain');
    const item=uncertain??batch.items.find(x=>x.state==='ready');
    if(!item){await message('Отправка пакета завершена.');return;}
    if(item.firstSentAt!==undefined&&now()-item.firstSentAt>=REQUEST_LIFETIME){await message(pauseErrors.generation_expired);return;}
    const wasUncertain=Boolean(uncertain);
    const file=await store.readFile(item.id);if(!file){await message('Исходное изображение недоступно. Новый запрос не отправлен.');return;}
    if(options.signal.aborted)return;
    await patch(item.id,{state:'sending',firstSentAt:item.firstSentAt??now(),error:undefined});
    await message('Отправляем следующую картинку.');
    if(options.signal.aborted){
      // No HTTP request was sent: restore the previous deadline, including no deadline for a new row.
      await patch(item.id,{state:wasUncertain?'uncertain':'ready',firstSentAt:item.firstSentAt});return;
    }
    let receiptSaved=false;
    try {
      const body=new FormData();body.set('prompt','');body.set('requestId',item.requestId);body.set('referenceImage',file,item.name);
      const {response,value}=await jsonRequest(withBasePath('/api/pet-generations'),{method:'POST',body});
      if(!response.ok) {
        const code=typeof value?.code==='string'?value.code:'generation_unavailable';
        if(wasUncertain)throw Error('still uncertain');
        if(code==='queue_full') {
          await patch(item.id,{state:'ready',firstSentAt:undefined});await message('Ждём места в очереди.');
          await wait([15000,30000,60000][Math.min(backoff++,2)]);continue;
        }
        if(['invalid_reference_image','reference_image_too_large','body_too_large'].includes(code)){
          await patch(item.id,{state:'invalid',error:'Сервис не принял изображение.'},true);continue;
        }
        if(pauseErrors[code]){await patch(item.id,{state:'ready',firstSentAt:undefined});await message(pauseErrors[code]);return;}
        throw Error('unconfirmed');
      }
      const generation=readGeneration(value);
      if(Date.parse(generation.expiresAt)<=now())throw Error('expired receipt');
      // Persist the receipt and delete only its input bytes in one transaction.
      await patch(item.id,{state:'accepted',receipt:{generationId:generation.generationId,expiresAt:generation.expiresAt,...(generation.createdAt?{createdAt:generation.createdAt}:{})},blocked:unknown(generation),historyPending:true,historySavedAt:now(),historyWarning:undefined},true);
      receiptSaved=true;
      await synchronizeBatchHistory(store,id,now(),remember,[item.id]);options.changed?.();
      backoff=0;
      if(unknown(generation)){await message('Исход генерации неизвестен. Отправка остановлена.');return;}
    } catch {
      if(receiptSaved)throw new Error('Задача принята, но дальнейшее сохранение недоступно. Её ссылка сохранена в пакете.');
      // A failed receipt transaction retains the file and UUID for an identical replay.
      await patch(item.id,{state:'uncertain',error:'Отправка не подтверждена.'});
      await message('Отправка не подтверждена. Продолжение проверит тот же запрос.');return;
    }
  }
}
