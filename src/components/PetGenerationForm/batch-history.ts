import {reconcileGenerationHistoryReceipt} from '@/lib/pets/generation/history';
import type {BatchItem} from './batch-model';
import type {BatchStore} from './batch-store';

export function needsHistorySync(item:BatchItem) {
  return Boolean(item.receipt&&(item.historyPending===true||(item.historyPending===undefined&&item.historyWarning===true)));
}
export async function synchronizeBatchHistory(store:BatchStore,id:string,now=Date.now(),write=reconcileGenerationHistoryReceipt,itemIds?:string[]) {
  const batch=await store.read();if(!batch||batch.id!==id)return;
  for(const item of batch.items.filter(x=>needsHistorySync(x)&&(!itemIds||itemIds.includes(x.id)))) {
    const receipt=item.receipt!;
    const savedAt=item.historySavedAt??now;
    if(item.historyPending!==true||item.historySavedAt===undefined)await store.update(id,current=>{
      const row=current.items.find(x=>x.id===item.id&&x.requestId===item.requestId&&x.receipt?.generationId===receipt.generationId);
      if(row){row.historyPending=true;row.historySavedAt=savedAt;}return current;
    });
    let saved=false;try{saved=write(receipt,savedAt,now);}catch{/* Keep the durable pending flag. */}
    await store.update(id,current=>{
      const row=current.items.find(x=>x.id===item.id&&x.requestId===item.requestId&&x.receipt?.generationId===receipt.generationId);
      if(row){row.historyPending=!saved;row.historyWarning=!saved;}return current;
    });
  }
}
