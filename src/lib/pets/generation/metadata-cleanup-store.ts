import {TypedValues, withSession} from '@/lib/ydb/client';
import {withSerializableTransaction} from '@/lib/ydb/transaction';
import {bytesAt,rowsFromResult,textAt} from '@/lib/ydb/result';
import type {YdbQueryExecutor} from '@/lib/ydb/client';
import {GENERATION_TABLES} from '@/lib/pets/generation/store';
import {schedulerSchema} from '@/lib/pets/generation/model';
import type {CleanupStore,CleanupTransaction} from '@/lib/pets/generation/metadata-cleanup';

function transaction(execute: YdbQueryExecutor): CleanupTransaction {
  return {
    async read(id) {
      const result=await execute(`DECLARE $id AS Utf8;
SELECT payload, expires_at FROM ${GENERATION_TABLES.jobs} WHERE id=$id;`,{$id:TypedValues.utf8(id)});
      if(result.resultSets?.some(set=>set.truncated))throw Error('incomplete_job');
      const rows=rowsFromResult(result);
      if(!rows.length)return null;
      if(rows.length!==1)throw Error('incomplete_job');
      const cell=rows[0].items?.[1];
      const expiresMicros=String(cell?.uint64Value??cell?.uint32Value??'');
      if(!/^\d+$/.test(expiresMicros))throw Error('invalid_expiry');
      return {id,payload:textAt(rows[0],0),expiresMicros};
    },
    async active(id,now) {
      const result=await execute(`DECLARE $key AS Utf8; DECLARE $now AS Timestamp;
SELECT payload FROM ${GENERATION_TABLES.quotas} WHERE record_key=$key AND expires_at>$now;`,{$key:TypedValues.utf8('scheduler'),$now:TypedValues.timestamp(new Date(now))});
      const row=rowsFromResult(result)[0];
      if(!row)throw Error('scheduler_missing');
      const state=schedulerSchema.parse(JSON.parse(textAt(row,0)));
      if('version' in state){
        return state.providerSlots.some(slot=>slot.jobId===id) || state.heavy?.jobId===id ||
          state.active.some(lease=>lease.id===id && lease.until>now) ||
          (state.version===3 && state.tasks.some(task=>task.jobId===id && task.status==='running'));
      }
      return Boolean(state.active?.id===id && state.active.until>now);
    },
    async artifact(id,stage,now) {
      const result=await execute(`DECLARE $id AS Utf8; DECLARE $kind AS Utf8; DECLARE $now AS Timestamp;
SELECT bytes, expires_at FROM ${GENERATION_TABLES.artifacts} WHERE id=$id AND kind=$kind AND expires_at>$now;`,{$id:TypedValues.utf8(id),$kind:TypedValues.utf8(`stage-${stage}.png`),$now:TypedValues.timestamp(new Date(now))});
      if(result.resultSets?.some(set=>set.truncated))throw Error('incomplete_artifact');
      const row=rowsFromResult(result)[0];
      if (!row) return null;
      const cell = row.items?.[1];
      const expiresMicros = String(cell?.uint64Value ?? cell?.uint32Value ?? '');
      if (!/^\d+$/.test(expiresMicros)) throw Error('invalid_artifact_expiry');
      return {bytes: bytesAt(row, 0), expiresMicros};
    },
    async updatePayload(id,payload) {
      await execute(`DECLARE $id AS Utf8; DECLARE $payload AS Utf8;
UPDATE ${GENERATION_TABLES.jobs} SET payload=$payload WHERE id=$id;`,{$id:TypedValues.utf8(id),$payload:TypedValues.utf8(payload)});
    },
  };
}
export const metadataCleanupStore:CleanupStore={transaction:operation=>withSerializableTransaction(execute=>operation(transaction(execute)))};

// ID-only paging also supports an audit of other live jobs without loading a catalogue into memory.
export async function listLiveMetadataJobIds(now:number) {
  const ids:string[]=[];
  let after='';
  while(true){
    const result=await withSession(session=>session.executeQuery(`DECLARE $now AS Timestamp; DECLARE $after AS Utf8;
SELECT id FROM ${GENERATION_TABLES.jobs} WHERE expires_at>$now AND id>$after ORDER BY id LIMIT 100;`,{$now:TypedValues.timestamp(new Date(now)),$after:TypedValues.utf8(after)}));
    if(result.resultSets?.some(set=>set.truncated))throw Error('incomplete_job_ids');
    const page=rowsFromResult(result).map(row=>textAt(row,0));
    if(!page.length)return ids;
    if(page.some(id=>id<=after))throw Error('invalid_job_page');
    ids.push(...page);after=page.at(-1)!;
  }
}
