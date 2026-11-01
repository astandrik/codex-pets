"use client";

import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from "react";
import {Button,Dialog,TextArea} from "@gravity-ui/uikit";
import {useRouter} from "next/navigation";
import {withBasePath} from "@/lib/base-path";
import {rememberGeneration} from "@/lib/pets/generation/history";
import {publicGenerationError} from "@/lib/pets/generation/public-error";
import {baseRetryOptionsSchema,baseRetryReplySchema,type BaseRetryInput,type BaseRetryMode,type BaseRetryOptions,type BaseRetryReply} from "@/lib/pets/generation/base-retry-model";
import {readBaseRetryRequest,prepareBaseRetryRequest,clearBaseRetryRequest,readBaseRetrySettings,type SavedBaseRetryRequest} from "./base-retry-request";
import {GenerationRetryControl} from "./GenerationRetryControl";
import {parseMaxRetriesInput} from "./continuation-request";
import "./BaseGenerationRetry.scss";

const DEFINITE=new Set(["invalid_argument","invalid_origin","body_too_large","base_retry_disabled","base_retry_unavailable","base_retry_input_missing","base_retry_source_conflict","generation_review_disabled","generation_disabled","generation_paused","generation_expired","not_found","saved_stage_unavailable","rate_limited","queue_full","budget_exhausted","client_ip_unavailable"]);
const subscribe=()=>()=>{};
type Props={generationId:string;canRetry:boolean};

export function BaseGenerationRetry(props:Props){
  const browser=useSyncExternalStore(subscribe,()=>true,()=>false);
  return browser?<BaseGenerationRetryForm key={props.generationId} {...props}/>:null;
}
function BaseGenerationRetryForm({generationId,canRetry}:Props){
  const router=useRouter();
  const endpoint=withBasePath(`/api/pet-generations/${generationId}/base-retries`);
  const pendingRef=useRef(false),controller=useRef<AbortController|null>(null);
  const [initialRequest]=useState<SavedBaseRetryRequest|null>(()=>{try{return readBaseRetryRequest(localStorage,generationId);}catch{return null;}});
  const [initialSettings]=useState(()=>{try{return initialRequest?readBaseRetrySettings(localStorage,generationId,initialRequest.requestId):null;}catch{return null;}});
  const [retrySettingsUntrusted,setRetrySettingsUntrusted]=useState(false);
  const [retryCount,setRetryCount]=useState(initialSettings?.maxRetries==null?"":String(initialSettings.maxRetries));
  const [legacyRetries,setLegacyRetries]=useState(initialSettings?.maxRetries===null);
  const retryInitialized=useRef(Boolean(initialRequest));
  const [acceptedGeneration,setAcceptedGeneration]=useState<BaseRetryReply["generation"]|null>(null);
  const [pending,setPending]=useState<SavedBaseRetryRequest|null>(initialRequest);
  const [submitted,setSubmitted]=useState<BaseRetryInput|null>(null);
  const [open,setOpen]=useState(Boolean(initialRequest)),[busy,setBusy]=useState(Boolean(initialRequest)),[error,setError]=useState("");
  const [options,setOptions]=useState<BaseRetryOptions|null>(null),[mode,setMode]=useState<BaseRetryMode|"">(initialRequest?.mode??""),[prompt,setPrompt]=useState("");
  const [acceptedUrl,setAcceptedUrl]=useState("");
  const begin=useCallback(()=>{if(pendingRef.current)return null;pendingRef.current=true;setBusy(true);setError("");const c=new AbortController();controller.current=c;return c;},[]);
  const end=useCallback((c:AbortController)=>{if(controller.current!==c)return;pendingRef.current=false;if(!c.signal.aborted)setBusy(false);},[]);
  const accepted=useCallback((generation:BaseRetryReply["generation"],requestId?:string,navigate=false)=>{
    if(generation.generationId===generationId)throw Error("invalid_reply");
    setAcceptedGeneration(generation);
    const url=withBasePath(`/generated/${generation.generationId}`);setAcceptedUrl(url);
    if(!rememberGeneration(generation.generationId,generation.expiresAt)){
      setError("Повтор принят, но историю сохранить не удалось. Сохраните ссылку ниже.");return;
    }
    if(requestId){try{clearBaseRetryRequest(localStorage,generationId,requestId);}catch{/* The accepted link remains usable. */}setPending(null);}
    if(navigate){try{router.push(url);}catch{setError("Повтор принят. Откройте сохранённую ссылку ниже.");}}
  },[generationId,router]);
  const parseReply=useCallback((raw:unknown,id:string,navigate=false)=>{
    const reply=baseRetryReplySchema.parse(raw);
    if(reply.requestId!==id||reply.sourceGenerationId!==generationId)throw Error("invalid_reply");
    accepted(reply.generation,id,navigate);
  },[accepted,generationId]);
  const fetchOptions=useCallback(async(signal:AbortSignal)=>{
    const r=await fetch(endpoint,{cache:"no-store",signal});const raw=await r.json();
    if(signal.aborted)return;
    if(!r.ok)throw Error("Исходные данные недоступны. Проверка ранее отправленного запроса остаётся доступна.");
    const value=baseRetryOptionsSchema.parse(raw&&typeof raw==="object"&&"options"in raw?raw.options:null);
    setOptions(value);
    if("existingGeneration"in value)accepted(value.existingGeneration);
    else {
      setMode(current=>current||(value.inputState==="saved"?"saved":""));
      if(!retryInitialized.current){
        if(value.baseRetries)setRetryCount(String(value.baseRetries.default));
        retryInitialized.current=true;
      }
    }
  },[endpoint,accepted]);
  const readReceipt=useCallback(async(saved:SavedBaseRetryRequest,c:AbortController)=>{
    if(c.signal.aborted)return;
    try{
      const r=await fetch(endpoint+"?requestId="+saved.requestId,{cache:"no-store",signal:c.signal});const raw=await r.json();
      if(c.signal.aborted)return;
      if(r.ok)parseReply(raw,saved.requestId);
      else if(r.status===404){setError("Ответ пока не подтверждён. Можно повторить тот же запрос с сохранённым UUID.");await fetchOptions(c.signal);}
      else setError(r.status===410?"Результат повторной задачи истёк.":"Не удалось проверить запрос. UUID сохранён.");
    }catch{if(!c.signal.aborted)setError("Не удалось подтвердить ответ. UUID сохранён; проверьте запрос позже.");}
    finally{end(c);}
  },[end,endpoint,parseReply,fetchOptions]);
  const check=useCallback(async(saved:SavedBaseRetryRequest)=>{
    const c=begin();if(!c)return;setOpen(true);await readReceipt(saved,c);
  },[begin,readReceipt]);
  useEffect(()=>{
    if(initialRequest){
      const c=new AbortController();controller.current=c;pendingRef.current=true;
      // Pending UI is initialized above; allow cleanup before starting the lookup.
      void Promise.resolve().then(()=>readReceipt(initialRequest,c));
    }
    return()=>controller.current?.abort();
  },[initialRequest,readReceipt]);
  async function show(){const c=begin();if(!c)return;setOpen(true);try{await fetchOptions(c.signal);}catch{if(!c.signal.aborted)setError("Не удалось прочитать исходные данные. Попробуйте проверить их ещё раз.");}finally{end(c);}}
  async function submit(){
    if(!canRetry||!options||"existingGeneration"in options||!mode||options.blockedReason||acceptedUrl)return;
    const needsCount=Boolean(pending||options.baseRetries);
    const maxRetries=legacyRetries?undefined:parseMaxRetriesInput(retryCount,50);
    if(needsCount&&!legacyRetries&&maxRetries===null)return;
    const c=begin();if(!c)return;
    let prepared:Awaited<ReturnType<typeof prepareBaseRetryRequest>>|undefined;
    try{
      try{prepared=await prepareBaseRetryRequest(localStorage,generationId,{sourceRevision:pending?.sourceRevision??options.sourceRevision,mode,...(mode==="legacy-text"?{prompt}:{}),...(needsCount&&maxRetries!=null?{maxRetries}:{})});}
      catch(e){
        const mismatch=e instanceof Error&&e.message==="base_retry_replay_mismatch";
        if(mismatch)setRetrySettingsUntrusted(true);
        setError(mismatch?"Введите прежние описание и число автоповторов: запрос с этим UUID уже отправлялся.":"Не удалось сохранить запрос для восстановления. Новая задача не отправлена.");return;
      }
      if(c.signal.aborted)return;
      setPending({requestId:prepared.input.requestId,sourceRevision:prepared.input.sourceRevision,mode:prepared.input.mode,fingerprint:prepared.fingerprint});setSubmitted(prepared.input);setLegacyRetries(prepared.input.maxRetries===undefined);
      const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(prepared.input),cache:"no-store",signal:c.signal});const raw=await r.json();
      if(c.signal.aborted)return;
      if(!r.ok){
        const code=raw&&typeof raw==="object"&&"code"in raw&&typeof raw.code==="string"?raw.code:"generation_unavailable";
        if(prepared.isNew&&DEFINITE.has(code)){clearBaseRetryRequest(localStorage,generationId,prepared.input.requestId);setPending(null);setSubmitted(null);}
        const failure=publicGenerationError(code);setError(failure.message+" "+failure.hint);return;
      }
      parseReply(raw,prepared.input.requestId,true);
    }catch{if(!c.signal.aborted)setError("Ответ не подтверждён. UUID сохранён; проверьте запрос перед новой отправкой.");}
    finally{end(c);}
  }
  if(!canRetry&&!pending&&!acceptedUrl)return null;
  const inputOptions=options&&!("existingGeneration"in options)?options:null;
  const showRetries=Boolean(inputOptions?.baseRetries||pending||submitted||acceptedGeneration);
  const needsRetrySettingsRecovery=!initialSettings||retrySettingsUntrusted;
  const policyLocked=Boolean(submitted||acceptedGeneration||pending&&!needsRetrySettingsRecovery);
  const displayedRetries=acceptedGeneration?(acceptedGeneration.baseRepair?String(acceptedGeneration.baseRepair.maxAttempts-1):""):retryCount;
  const displayedLegacy=acceptedGeneration?!acceptedGeneration.baseRepair:legacyRetries;
  const countInvalid=showRetries&&!displayedLegacy&&parseMaxRetriesInput(displayedRetries,50)===null;
  const locked=busy||Boolean(submitted)||Boolean(acceptedUrl);
  const submitDisabled=!canRetry||busy||countInvalid||!inputOptions||!!inputOptions.blockedReason||!mode||(mode==="legacy-text"&&!prompt.trim())||!!acceptedUrl;
  return <section className="base-generation-retry">
    <Button type="button" disabled={busy} onClick={()=>pending?void check(pending):void show()}>{pending?"Проверить повтор":"Повторить создание персонажа"}</Button>
    <Dialog open={open} onClose={()=>setOpen(false)} keepMounted returnFocus disableBodyScrollLock={!open} contentOverflow="auto" size="m" className="base-generation-retry__dialog" aria-labelledby="base-generation-retry-title">
      <Dialog.Header caption={<h2 id="base-generation-retry-title">Повторить создание персонажа</h2>}/>
      <Dialog.Body>
        <p>Будет использована одна новая попытка дневного лимита. Каждый вызов генерации расходует бюджет сервиса. Исходная задача и её срок не изменятся.</p>
        {/* Private capability image bypasses the shared image optimizer. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {inputOptions?.referenceUrl&&<img className="base-generation-retry__reference" src={inputOptions.referenceUrl} alt="Сохранённый референс" referrerPolicy="no-referrer"/>}
        {inputOptions?.displayName&&<p>{inputOptions.displayName}</p>}
        {inputOptions?.inputState==="saved"&&<><h3>Исходное описание</h3><p className="base-generation-retry__description">{inputOptions.prompt||"Только изображение, без описания."}</p></>}
        {inputOptions?.inputState==="legacy"&&<>
          <p>Исходное описание не сохранилось. Укажите, что нужно отправить.</p>
          <fieldset disabled={locked}><legend>Исходные данные</legend>
            {inputOptions.availableModes.includes("legacy-image-only")&&<label><input type="radio" name="base-retry-mode" value="legacy-image-only" checked={mode==="legacy-image-only"} onChange={()=>setMode("legacy-image-only")}/>Было только изображение</label>}
            <label><input type="radio" name="base-retry-mode" value="legacy-text" checked={mode==="legacy-text"} onChange={()=>setMode("legacy-text")}/>Ввести описание заново</label>
          </fieldset>
          {mode==="legacy-text"&&<><label htmlFor="base-retry-prompt">Ваше описание</label><TextArea id="base-retry-prompt" value={prompt} onUpdate={setPrompt} disabled={locked} minRows={3} controlProps={{maxLength:2000}}/></>}
        </>}
        {inputOptions?.blockedReason&&<p role="status">Новые повторы сейчас недоступны. Ранее отправленный запрос можно проверить.</p>}
        {pending&&!submitted&&pending.mode==="legacy-text"&&<p>Для повторной отправки введите то же описание. Текст не сохраняется в браузере.</p>}
        {showRetries&&<GenerationRetryControl subject="base" value={displayedRetries} max={50} disabled={busy||policyLocked} legacy={displayedLegacy} allowLegacy={Boolean(pending&&needsRetrySettingsRecovery&&!submitted&&!acceptedGeneration)} onChange={setRetryCount} onLegacy={setLegacyRetries}/>}
        {error&&<p role="alert">{error}</p>}
        {acceptedUrl&&<p role="status">Повтор принят. <a href={acceptedUrl}>Открыть новую задачу</a></p>}
      </Dialog.Body>
      <Dialog.Footer>
        {!acceptedUrl&&<Button type="button" view="action" disabled={submitDisabled} loading={busy} onClick={()=>void submit()}>Создать новую попытку</Button>}
        {pending&&!acceptedUrl&&<Button type="button" disabled={busy} onClick={()=>void check(pending)}>Проверить запрос</Button>}
        <Button type="button" onClick={()=>setOpen(false)}>Закрыть</Button>
      </Dialog.Footer>
    </Dialog>
  </section>;
}
