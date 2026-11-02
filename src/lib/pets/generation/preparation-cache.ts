type Files = ReadonlyMap<string, Buffer>;
type Entry = {expiresAt:number; bytes:number; result:Promise<Files>};

/** Only derived, immutable preparation files; never provider results or workspaces. */
export function createPreparationCache(maxBytes = 32 * 1024 * 1024, maxEntries = 7) {
  const entries = new Map<string, Entry>();
  function trim(now:number) {
    for (const [key,entry] of entries) if (entry.expiresAt <= now) entries.delete(key);
    while (entries.size > maxEntries || [...entries.values()].reduce((sum,e)=>sum+e.bytes,0) > maxBytes) entries.delete(entries.keys().next().value!);
  }
  return {
    async get(key:string,expiresAt:number,now:number,build:()=>Promise<Files>):Promise<Files> {
      trim(now);
      const found=entries.get(key);
      if(found){entries.delete(key);entries.set(key,found);return found.result;}
      const entry:Entry={expiresAt,bytes:0,result:Promise.resolve().then(build)};
      entries.set(key,entry);trim(now);
      try{
        const files=await entry.result;
        entry.bytes=[...files.values()].reduce((sum,bytes)=>sum+bytes.length,0);
        if(!files.size || entry.bytes>maxBytes) {if(entries.get(key)===entry)entries.delete(key);}
        trim(now);return files;
      }catch(error){if(entries.get(key)===entry)entries.delete(key);throw error;}
    },
  };
}
