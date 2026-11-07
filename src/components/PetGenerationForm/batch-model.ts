import {z} from 'zod';

export const BATCH_LIMIT=100;
export const BATCH_TTL=7*86_400_000;
export const REQUEST_LIFETIME=86_400_000;
export const BATCH_LOCK='pets-image-batch-sender';
const uuid=z.uuid();
export const receiptSchema=z.object({generationId:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.iso.datetime(),createdAt:z.iso.datetime().optional()});
export const batchSchema=z.object({
  id:uuid,createdAt:z.number().finite(),expiresAt:z.number().finite(),started:z.boolean(),total:z.number().int().nonnegative().optional(),message:z.string().optional(),
  items:z.array(z.object({
    id:uuid,requestId:uuid,name:z.string(),type:z.string(),state:z.enum(['ready','sending','uncertain','accepted','invalid']),
    firstSentAt:z.number().optional(),
    receipt:receiptSchema.optional(),error:z.string().optional(),historyWarning:z.boolean().optional(),historyPending:z.boolean().optional(),historySavedAt:z.number().finite().optional(),blocked:z.boolean().optional(),
  })).max(BATCH_LIMIT),
}).superRefine((batch,ctx)=>{
  if(new Set(batch.items.map(x=>x.id)).size!==batch.items.length || new Set(batch.items.map(x=>x.requestId)).size!==batch.items.length)ctx.addIssue({code:'custom',message:'Повторяющиеся идентификаторы в сохранённом пакете.'});
  if(batch.items.some(x=>x.state==='accepted'&&!x.receipt))ctx.addIssue({code:'custom',message:'Отсутствует подтверждение принятой задачи.'});
});
export type ImageBatch=z.infer<typeof batchSchema>;
export type BatchItem=ImageBatch['items'][number];
export type BatchSnapshot={id:string|null;value:string};
export function batchSnapshot(batch:ImageBatch|null):BatchSnapshot {
  return {id:batch?.id??null,value:JSON.stringify(batch?{
    id:batch.id,started:batch.started,expiresAt:batch.expiresAt,
    items:batch.items.map(item=>({id:item.id,requestId:item.requestId,name:item.name,type:item.type,state:item.state,firstSentAt:item.firstSentAt,receipt:item.receipt,blocked:item.blocked})),
  }:null)};
}
export function assertBatchSnapshot(batch:ImageBatch|null,expected:BatchSnapshot) {
  if(batchSnapshot(batch).value!==expected.value)throw new Error('Пакет изменился в другой вкладке. Проверьте список и нажмите ещё раз.');
}
export function createBatch(now=Date.now()):ImageBatch {
  return {id:crypto.randomUUID(),createdAt:now,expiresAt:now+BATCH_TTL,started:false,items:[]};
}
export function pruneExpiredBatch(batch:ImageBatch,now:number):ImageBatch|null {
  if(batch.expiresAt>now)return batch;
  const lastResult=Math.max(batch.expiresAt,...batch.items.map(x=>x.receipt?Date.parse(x.receipt.expiresAt):0));
  if(lastResult<=now)return null;
  return {...batch,message:'Срок хранения неотправленных изображений истёк.',items:batch.items.map(item=>item.receipt?item:{...item,state:'invalid',error:'Срок хранения исходного файла истёк.'})};
}
export function readGeneration(value:unknown) {
  const envelope=z.object({generation:receiptSchema.extend({status:z.enum(['queued','generating','awaiting_confirmation','processing','completed','failed']),error:z.object({code:z.string()}).passthrough().optional()})}).parse(value);
  return envelope.generation;
}
