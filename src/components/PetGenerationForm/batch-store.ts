import {assertBatchSnapshot,batchSchema,createBatch,pruneExpiredBatch,type BatchItem,type ImageBatch,type BatchSnapshot} from './batch-model';

type Edits={removeFiles?:string[];removePreviews?:string[]};
export interface BatchStore {
  read():Promise<ImageBatch|null>;
  update(id:string,change:(batch:ImageBatch)=>ImageBatch,edits?:Edits):Promise<void>;
  readFile(id:string):Promise<Blob|null>;
  readPreview(id:string):Promise<Blob|null>;
  add(item:BatchItem,file:Blob|undefined,preview:Blob|undefined,expected:BatchSnapshot):Promise<void>;
  clear(expected:BatchSnapshot):Promise<void>;
  maintain(now:number):Promise<void>;
}

export function openBatchStore():Promise<BatchStore> {
  return new Promise((resolve,reject)=>{
    let blocked=false;
    const request=indexedDB.open('pets-image-batches',1);
    request.onupgradeneeded=()=>{for(const name of ['batch','files','previews'])request.result.createObjectStore(name);};
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>{blocked=true;reject(new Error('Закройте старые вкладки сайта и повторите.'));};
    request.onsuccess=()=>{
      if(blocked){request.result.close();return;}
      const db=request.result;db.onversionchange=()=>db.close();
      function read<T>(store:string,key:string):Promise<T|null> {
        return new Promise((res,rej)=>{
          const tx=db.transaction(store,'readonly');const req=tx.objectStore(store).get(key);
          tx.oncomplete=()=>res(req.result??null);tx.onabort=()=>rej(tx.error);tx.onerror=()=>rej(tx.error);
        });
      }
      function change(fn:(batch:ImageBatch|null,tx:IDBTransaction)=>void):Promise<void> {
        return new Promise((res,rej)=>{
          const tx=db.transaction(['batch','files','previews'],'readwrite');let failure:unknown;
          const req=tx.objectStore('batch').get('current');
          req.onsuccess=()=>{try{fn(req.result===undefined?null:batchSchema.parse(req.result),tx);}catch(e){failure=e;tx.abort();}};
          tx.oncomplete=()=>res();tx.onabort=()=>rej(failure??tx.error??new Error('Не удалось сохранить пакет.'));tx.onerror=()=>{failure??=tx.error;};
        });
      }
      resolve({
        async read(){const value=await read<unknown>('batch','current');return value===null?null:batchSchema.parse(value);},
        readFile:id=>read<Blob>('files',id),readPreview:id=>read<Blob>('previews',id),
        update(id,fn,edits={}){return change((current,tx)=>{
          if(!current||current.id!==id)throw new Error('Пакет изменился в другой вкладке.');
          tx.objectStore('batch').put(batchSchema.parse(fn(current)),'current');
          for(const key of edits.removeFiles??[])tx.objectStore('files').delete(key);
          for(const key of edits.removePreviews??[])tx.objectStore('previews').delete(key);
        });},
        add(item,file,preview,expected){return change((current,tx)=>{
          assertBatchSnapshot(current,expected);
          const batch=current??createBatch();
          if(batch.started)throw new Error('Этот пакет уже запущен.');
          batch.items.push(item);tx.objectStore('batch').put(batchSchema.parse(batch),'current');
          if(file)tx.objectStore('files').put(file,item.id);
          if(preview)tx.objectStore('previews').put(preview,item.id);
        });},
        clear(expected){return change((current,tx)=>{
          assertBatchSnapshot(current,expected);
          for(const name of ['batch','files','previews'])tx.objectStore(name).clear();
        });},
        maintain(now){return change((current,tx)=>{
          if(!current||current.expiresAt>now)return;
          const pruned=pruneExpiredBatch(current,now);
          if(!pruned){for(const name of ['batch','files','previews'])tx.objectStore(name).clear();return;}
          tx.objectStore('batch').put(pruned,'current');
          for(const item of current.items)if(!item.receipt){tx.objectStore('files').delete(item.id);tx.objectStore('previews').delete(item.id);}
        });},
      });
    };
  });
}
