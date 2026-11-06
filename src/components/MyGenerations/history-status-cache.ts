import type {GenerationHistoryEntry, HistoryGeneration, GenerationSubmission} from "@/lib/pets/generation/history";

export type HistoryStatus = {generation?:HistoryGeneration; unavailable?:boolean; failedReads:number; submission?:GenerationSubmission; checkedAt?:number; checking?:boolean};
type CachedStatus = {entry:GenerationHistoryEntry; result:HistoryStatus; signal:string|null};
const statuses = new Map<string,CachedStatus>();
export const HISTORY_STATUS_FRESH_MS = 30_000;

export function statusObservationFresh(result:HistoryStatus,now:number):boolean {
  return !result.checking && result.checkedAt !== undefined && now >= result.checkedAt && now-result.checkedAt < HISTORY_STATUS_FRESH_MS;
}

export function cachedHistoryStatus(entry:GenerationHistoryEntry):HistoryStatus|undefined {
  if(typeof window==="undefined")return;
  const cached=statuses.get(entry.generationId);
  if(cached?.entry.savedAt===entry.savedAt&&cached.entry.expiresAt===entry.expiresAt)return cached.result;
}

export function historyStatusFresh(entry:GenerationHistoryEntry,signal:string|null,now:number):boolean {
  if(!cachedHistoryStatus(entry))return false;
  const cached=statuses.get(entry.generationId)!;
  return cached.signal===signal&&statusObservationFresh(cached.result,now);
}

export function cacheHistoryStatus(entry:GenerationHistoryEntry,result:HistoryStatus,signal:string|null,now:number){
  if(typeof window!=="undefined") {
    const previous = statuses.get(entry.generationId)?.result;
    const submission = result.submission ?? result.generation?.submission ?? previous?.submission ?? previous?.generation?.submission;
    statuses.set(entry.generationId,{entry,result:{...result,checkedAt:now,checking:false,...(submission?{submission}:{})},signal});
  }
}

export function pruneHistoryStatuses(entries:GenerationHistoryEntry[]){
  if(typeof window==="undefined")return;
  const retained=new Set(entries.map(entry=>entry.generationId));
  for(const id of statuses.keys())if(!retained.has(id))statuses.delete(id);
}

export function cacheHistorySubmission(entry:GenerationHistoryEntry, submission:GenerationSubmission) {
  if(typeof window === 'undefined') return;
  const previous = statuses.get(entry.generationId);
  statuses.set(entry.generationId, {entry, signal:previous?.signal ?? null, result:{...(previous?.result ?? {failedReads:0}), submission}});
}
