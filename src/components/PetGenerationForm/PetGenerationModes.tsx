"use client";
import {useEffect,useRef,useState, type ComponentProps} from 'react';
import {Button} from '@gravity-ui/uikit';
import {PetGenerationForm} from './PetGenerationForm';
import {PetGenerationBatch} from './PetGenerationBatch';
import {openBatchStore} from './batch-store';
import './PetGenerationBatch.scss';

export function PetGenerationModes(props:ComponentProps<typeof PetGenerationForm>) {
  const [batch,setBatch]=useState(false),[hasSaved,setHasSaved]=useState(false);
  const chosen=useRef(false);
  useEffect(()=>{
    let active=true;
    if(globalThis.indexedDB)void openBatchStore().then(store=>store.read()).then(saved=>{
      if(active){setHasSaved(Boolean(saved));if(!chosen.current&&saved)setBatch(true);}
    }).catch(()=>{});
    return()=>{active=false;};
  },[props.reviewBase]);
  function select(value:boolean){chosen.current=true;setBatch(value);}
  const showBatch=batch&&(Boolean(props.reviewBase)||hasSaved);
  return <>
    {(props.reviewBase||hasSaved)&&<div className="generation-modes" role="group" aria-label="Режим создания">
      <Button selected={!batch} onClick={()=>select(false)}>Один питомец</Button>
      <Button selected={batch} onClick={()=>select(true)}>Пакет изображений</Button>
    </div>}
    <div hidden={showBatch} inert={showBatch} onInputCapture={()=>{chosen.current=true;}}><PetGenerationForm {...props}/></div>
    {showBatch&&<PetGenerationBatch enabled={props.enabled&&Boolean(props.reviewBase)} admissionAvailable={props.queueLimit!==null&&props.dailyQuotaLimits!==null} onAvailabilityChange={setHasSaved}/>}
  </>;
}
