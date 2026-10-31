import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {withBasePath} from '@/lib/base-path';
import {getPetSheet,PET_STATES} from '@/lib/pets/types';
import {CONTINUATION_STATES,type ContinuationOptions,type ContinuationPreview} from '@/lib/pets/generation/continuation-model';
import {jobRevision,requireContinuationSource,type SourceSnapshot} from '@/lib/pets/generation/continuation-source';
import {GENERATION_ID,GenerationError} from '@/lib/pets/generation/model';
import {validateGeneratedSheet,MAX_GENERATED_BYTES} from '@/lib/pets/generation/package';
import type {GenerationStore} from '@/lib/pets/generation/store';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
const atlasAssets=['atlas-source','atlas-continuation','atlas-revision'];
function imageUrl(id:string,asset:string,hash:string){return withBasePath(`/api/pet-generations/${id}/continuation-preview/${asset}?v=${hash}`);}
export function buildContinuationPreviews(snapshot:SourceSnapshot):Pick<ContinuationOptions,'character'|'strips'> {
 const {job,atlas,atlasKind,raws,targets}=snapshot;
 const asset=atlasKind==='source.png'?'atlas-source':atlasKind==='revision-source.webp'?'atlas-revision':'atlas-continuation';
 const atlasUrl=atlas?imageUrl(job.id,asset,digest(atlas)):undefined;
 return {
  character:{...(job.displayName!=='Generated pet'||job.nameSource==='user'?{displayName:job.displayName}:{}),...(job.cardMetadata?.fields?.description?{description:job.cardMetadata.fields.description}:{}),baseUrl:withBasePath(`/api/pet-generations/${job.id}/base`),expiresAt:new Date(job.expiresAt).toISOString()},
  strips:snapshot.options.strips.map(strip=>{
   let preview:ContinuationPreview|undefined;
   if(targets.includes(strip.state)){
    const raw=raws.get(strip.state);if(raw)preview={kind:'source-image',url:imageUrl(job.id,strip.state,digest(raw))};
   }else if(atlasUrl){
    const animation=PET_STATES.find(s=>s.key===strip.state);
    preview={kind:'atlas-row',url:atlasUrl,row:animation?.row??(strip.state==='look-0-157'?9:10),frames:animation?.frames??8};
   }
   return {...strip,...(preview?{preview}:{})};
  }),
 };
}
function animatedPng(bytes:Buffer){
 for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset);if(length>bytes.length-offset-12)break;if(bytes.toString('ascii',offset+4,offset+8)==='acTL')return true;offset+=length+12;}
 return false;
}
export async function readContinuationPreview(store:Pick<GenerationStore,'readJob'|'readArtifact'>,id:string,asset:string,version:string,now:()=>number=Date.now){
 if(!GENERATION_ID.test(id)||!/^[a-f0-9]{64}$/.test(version)||(!CONTINUATION_STATES.some(s=>s===asset)&&!atlasAssets.includes(asset)))throw new GenerationError('not_found');
 const job=requireContinuationSource(await store.readJob(id),now());
 let kind:string,expected:string|undefined;
 const atlas=atlasAssets.includes(asset);
 if(asset==='atlas-source')kind='source.png';
 else if(asset==='atlas-continuation'){if(!job.continuation?.atlas)throw new GenerationError('not_found');kind=job.continuation.atlas.kind;expected=job.continuation.atlas.sha256;}
 else if(asset==='atlas-revision'){if(!job.animationRevision)throw new GenerationError('not_found');kind='revision-source.webp';expected=job.animationRevision.sourceAtlasSha256;}
 else{const stage=job.stages.find(s=>s.name===asset&&s.status==='completed');if(!stage?.sha256)throw new GenerationError('not_found');kind=`stage-${asset}.png`;expected=stage.sha256;}
 if(expected&&expected!==version)throw new GenerationError('continuation_source_conflict');
 const bytes=await store.readArtifact(id,kind,now());if(!bytes)throw new GenerationError('not_found');
 if(!bytes.length||bytes.length>MAX_GENERATED_BYTES)throw new GenerationError('saved_stage_unavailable');
 if(digest(bytes)!==version)throw new GenerationError('continuation_source_conflict');
 let contentType:'image/png'|'image/webp';
 try{
  const image=sharp(bytes,{limitInputPixels:25_000_000,failOn:'warning'}),meta=await image.metadata();
  if((meta.pages??1)!==1||(!atlas&&meta.format!=='png')||(meta.format!=='png'&&meta.format!=='webp')||(meta.format==='png'&&animatedPng(bytes)))throw Error('format');
  if(atlas){await validateGeneratedSheet(bytes);const sheet=getPetSheet(2);if(meta.width!==sheet.width||meta.height!==sheet.height)throw Error('size');}
  else await image.ensureAlpha().raw().toBuffer();
  contentType=meta.format==='png'?'image/png':'image/webp';
 }catch{throw new GenerationError('saved_stage_unavailable');}
 const current=requireContinuationSource(await store.readJob(id),now());
 if(jobRevision(current)!==jobRevision(job))throw new GenerationError('continuation_source_conflict');
 return {bytes,contentType};
}
