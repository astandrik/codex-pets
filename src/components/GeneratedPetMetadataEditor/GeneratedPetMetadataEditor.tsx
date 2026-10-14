"use client";

import {useEffect,useRef,useState} from "react";
import {Button,TextArea,TextInput} from "@gravity-ui/uikit";
import {withBasePath} from "@/lib/base-path";
import {normalizeCardMetadata,publicCardMetadataSchema,type PublicCardMetadata} from "@/lib/pets/generation/card-metadata";
import "./GeneratedPetMetadataEditor.scss";

type Props={generationId:string;metadata:PublicCardMetadata;disabled:boolean;onBlocked:(blocked:boolean)=>void;onSaved:(metadata:PublicCardMetadata)=>void};
export function GeneratedPetMetadataEditor({generationId,metadata,disabled,onBlocked,onSaved}:Props){
  const [displayName,setDisplayName]=useState(metadata.displayName??"");
  const [saved,setSaved]=useState(metadata),[description,setDescription]=useState(metadata.description),[tags,setTags]=useState(metadata.tags.join(", "));
  const [saving,setSaving]=useState(false),[error,setError]=useState(""),[conflict,setConflict]=useState(false);
  const pending=useRef(false),controller=useRef<AbortController|null>(null);
  const locked=disabled||!metadata.editable,dirty=displayName!==(saved.displayName??"")||description!==saved.description||tags!==saved.tags.join(", ");
  useEffect(()=>()=>controller.current?.abort(),[]);
  function change(nextDescription:string,nextTags:string,nextName=displayName){
    setDisplayName(nextName);
    setDescription(nextDescription);setTags(nextTags);setError("");
    onBlocked(nextName!==(saved.displayName??"")||nextDescription!==saved.description||nextTags!==saved.tags.join(", ")||saving);
  }
  async function save(event:React.FormEvent){
    event.preventDefault();if(locked||pending.current||!dirty)return;
    let fields;try{fields=normalizeCardMetadata({...(displayName||saved.displayName!==undefined?{displayName}:{}),description,tags:tags.split(",").map(tag=>tag.trim()).filter(Boolean)});}
    catch{setError("Enter a name up to 80 characters, a description up to 320 characters and at most 8 tags, up to 40 characters each.");return;}
    pending.current=true;const request=new AbortController();controller.current=request;setSaving(true);setError("");setConflict(false);onBlocked(true);
    try{
      const response=await fetch(withBasePath(`/api/pet-generations/${generationId}/metadata`),{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({...fields,revision:saved.revision}),cache:"no-store",signal:request.signal});
      if(request.signal.aborted)return;
      if(!response.ok){
        if(response.status===409){setError("These details changed in another tab or were already submitted. Reload the saved details before editing again.");setConflict(true);return;}
        if(response.status===404||response.status===410){setError("This result is unavailable or has expired. Reload to check it.");setConflict(true);return;}
        throw Error("save_unconfirmed");
      }
      const body:unknown=await response.json();const result=publicCardMetadataSchema.safeParse(body&&typeof body==="object"&&"metadata"in body?body.metadata:null);
      if(!result.success)throw Error("invalid_saved_metadata");if(request.signal.aborted)return;
      setSaved(result.data);setDisplayName(result.data.displayName??"");setDescription(result.data.description);setTags(result.data.tags.join(", "));onSaved(result.data);onBlocked(false);
    }catch{if(!request.signal.aborted)setError("Could not confirm the save. Retry saving the same details; this never starts a new generation.");}
    finally{pending.current=false;if(!request.signal.aborted)setSaving(false);}
  }
  return <form className="generated-pet-metadata" onSubmit={save}>
    <h2>Name, description and tags</h2>
    {metadata.automaticState==="failed"&&!saved.edited&&<p>Automatic details were unavailable. Your images are saved; you can enter the name, description and tags below.</p>}
    <label htmlFor="generated-name">Name</label>
    <TextInput id="generated-name" value={locked?(metadata.displayName??""):displayName} onUpdate={value=>change(description,tags,value)} disabled={saving} controlProps={{maxLength:80,readOnly:locked}}/>
    <label htmlFor="generated-description">Description</label>
    <TextArea id="generated-description" value={locked?metadata.description:description} onUpdate={value=>change(value,tags)} minRows={3} disabled={saving} controlProps={{maxLength:320,readOnly:locked}}/>
    <label htmlFor="generated-tags">Tags</label>
    <TextInput id="generated-tags" value={locked?metadata.tags.join(", "):tags} onUpdate={value=>change(description,value)} disabled={saving} controlProps={{maxLength:335,readOnly:locked}}/>
    <p>Up to 8 tags, separated by commas. The saved name and description are included in pet.json and ZIP; tags are used in the gallery submission.</p>
    {locked?<p>These details are locked after submission.</p>:<>
      <Button type="submit" view="outlined" loading={saving} disabled={saving||!dirty}>Save details</Button>
      <p role="status">{dirty?"Save your changes before downloading the updated package or submitting for review.":"Saved details are ready for download and moderation."}</p>
    </>}
    {error&&<p role="alert">{error}</p>}
    {conflict&&<a href={withBasePath(`/generated/${generationId}`)}>Reload saved details</a>}
  </form>;
}
