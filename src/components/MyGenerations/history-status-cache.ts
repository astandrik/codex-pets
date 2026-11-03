import type {GenerationHistoryEntry, HistoryGeneration} from "@/lib/pets/generation/history";

export type HistoryStatus = {generation?:HistoryGeneration; unavailable?:boolean; failedReads:number};
type CachedStatus = {entry:GenerationHistoryEntry; result:HistoryStatus; checkedAt:number; signal:string|null};
const statuses = new Map<string,CachedStatus>();
const FRESH_MS = 30_000;

export function cachedHistoryStatus(entry:GenerationHistoryEntry):HistoryStatus|undefined {
  if(typeof window==="undefined")return;
  const cached=statuses.get(entry.generationId);
  if(cached?.entry.savedAt===entry.savedAt&&cached.entry.expiresAt===entry.expiresAt)return cached.result;
}

export function historyStatusFresh(entry:GenerationHistoryEntry,signal:string|null,now:number):boolean {
  if(!cachedHistoryStatus(entry))return false;
  const cached=statuses.get(entry.generationId)!;
  return cached.signal===signal&&now>=cached.checkedAt&&now-cached.checkedAt<FRESH_MS;
}

export function cacheHistoryStatus(entry:GenerationHistoryEntry,result:HistoryStatus,signal:string|null,now:number){
  if(typeof window!=="undefined")statuses.set(entry.generationId,{entry,result,signal,checkedAt:now});
}

export function pruneHistoryStatuses(entries:GenerationHistoryEntry[]){
  if(typeof window==="undefined")return;
  const retained=new Set(entries.map(entry=>entry.generationId));
  for(const id of statuses.keys())if(!retained.has(id))statuses.delete(id);
}
