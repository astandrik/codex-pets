import {createHash} from 'node:crypto';
import {z} from 'zod';
import {STAGE_NAMES} from '@/lib/pets/generation/model';

export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const rawJobSchema = z.object({id: hash, payload: z.string(), expiresMicros: z.string().regex(/^\d+$/)}).strict();
export type RawJob = z.infer<typeof rawJobSchema>;
export type CleanupArtifact = {bytes: Buffer; expiresMicros: string};
export const cleanupEntrySchema = z.object({
  id: hash, expiresMicros: z.string().regex(/^\d+$/), before: hash, after: hash,
  removedBytes: z.number().int().nonnegative(), stages: z.array(z.enum(STAGE_NAMES)),
  status: z.enum(['eligible', 'noop', 'skipped']), reason: z.string().optional(),
}).strict();
export type CleanupEntry = z.infer<typeof cleanupEntrySchema>;
export const cleanupManifestSchema = z.object({version: z.literal(1), entries: z.array(cleanupEntrySchema)}).strict().refine(value => new Set(value.entries.map(entry => entry.id)).size === value.entries.length, 'duplicate_id');
export type CleanupManifest = z.infer<typeof cleanupManifestSchema>;
export const cleanupBackupSchema = z.object({version: z.literal(1), manifest: cleanupManifestSchema, rows: z.array(rawJobSchema)}).strict();
export type CleanupBackup = z.infer<typeof cleanupBackupSchema>;

type Span = {key?: string; start: number; end: number; valueStart: number; valueEnd: number};
// Keep untouched JSON text byte-for-byte, including unknown fields and large integer literals.
function members(text: string, start: number): Span[] {
  const object = text[start] === '{';
  const endChar = object ? '}' : ']';
  const spans: Span[] = [];
  let pos = start + 1;
  const space = () => {while (/\s/.test(text[pos] ?? '') && pos < text.length) pos++;};
  const stringEnd = (from: number) => {
    let end = from + 1;
    while (end < text.length) {
      if (text[end] === '\\') end += 2;
      else if (text[end++] === '"') return end;
    }
    throw Error('invalid_json');
  };
  space();
  while (text[pos] !== endChar) {
    const propertyStart = pos;
    let key: string | undefined;
    if (object) {
      const end = stringEnd(pos);key = JSON.parse(text.slice(pos, end));pos = end;space();pos++;space();
    }
    const valueStart = pos;
    if (text[pos] === '"') pos = stringEnd(pos);
    else if (text[pos] === '[' || text[pos] === '{') {
      let depth = 0;
      do {
        if (text[pos] === '"') pos = stringEnd(pos);
        else {if (text[pos] === '[' || text[pos] === '{') depth++;if (text[pos] === ']' || text[pos] === '}') depth--;pos++;}
      } while (depth && pos < text.length);
    } else {while (pos < text.length && !/[\s,}\]]/.test(text[pos])) pos++;}
    const valueEnd = pos;space();
    spans.push({key, start: propertyStart, end: pos, valueStart, valueEnd});
    if (text[pos] === endChar) break;
    pos++;space();
  }
  return spans;
}

export async function planMetadataCleanup(row: RawJob, readArtifact: (stage: string) => Promise<CleanupArtifact | null>, now: number, active: boolean): Promise<{entry: CleanupEntry; payload: string; validUntilMicros: bigint}> {
  const before = digest(row.payload);
  let validUntilMicros = BigInt(row.expiresMicros);
  const entry: CleanupEntry = {id: row.id, expiresMicros: row.expiresMicros, before, after: before, removedBytes: 0, stages: [], status: 'noop'};
  const skip = (reason: string) => ({entry: {...entry, status: 'skipped' as const, reason}, payload: row.payload, validUntilMicros});
  if (BigInt(row.expiresMicros) <= BigInt(now) * BigInt(1000)) return skip('expired');
  if (active) return skip('active_lease_or_provider_slot');
  let raw;
  try {raw = JSON.parse(row.payload);} catch {return skip('invalid_json');}
  if (raw?.id !== row.id || !Array.isArray(raw.stages)) return skip('invalid_job');
  if (typeof raw.expiresAt !== 'number' || !Number.isFinite(raw.expiresAt) || raw.expiresAt <= now) return skip('expired');
  const logicalExpiryMicros = BigInt(Math.trunc(raw.expiresAt * 1000));
  if (logicalExpiryMicros < validUntilMicros) validUntilMicros = logicalExpiryMicros;
  if (typeof raw.leaseUntil === 'number' && raw.leaseUntil > now) return skip('active_lease_or_provider_slot');
  const root = members(row.payload, row.payload.search(/\S/));
  const stageArrays = root.filter(field => field.key === 'stages');
  if (root.filter(field => field.key === 'id').length !== 1 || stageArrays.length !== 1) return skip('ambiguous_stages');
  const removals: Array<[number, number]> = [];
  const seen = new Set<string>();
  for (const stageSpan of members(row.payload, stageArrays[0].valueStart)) {
    const stage = JSON.parse(row.payload.slice(stageSpan.valueStart, stageSpan.valueEnd));
    if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return skip('invalid_stage');
    if (!Object.hasOwn(stage, 'bytes')) continue;
    if (!STAGE_NAMES.includes(stage.name) || seen.has(stage.name) || stage.status !== 'completed') return skip('invalid_stage');
    seen.add(stage.name);
    const value = stage.bytes;
    if (value?.type !== 'Buffer' || Object.keys(value).sort().join(',') !== 'data,type' || !Array.isArray(value.data) || !value.data.length || value.data.length > 8 * 1024 * 1024 ||
        value.data.some((byte: unknown) => !Number.isInteger(byte) || Number(byte) < 0 || Number(byte) > 255)) return skip('invalid_buffer');
    const bytes = Buffer.from(value.data);
    const artifact = await readArtifact(stage.name);
    if (!artifact || !/^\d+$/.test(artifact.expiresMicros) || !artifact.bytes.equals(bytes) || digest(bytes) !== stage.sha256) return skip('artifact_mismatch');
    const artifactExpiryMicros = BigInt(artifact.expiresMicros);
    if (artifactExpiryMicros <= BigInt(now) * BigInt(1000)) return skip('expired_artifact');
    if (artifactExpiryMicros < validUntilMicros) validUntilMicros = artifactExpiryMicros;
    const fields = members(row.payload, stageSpan.valueStart);
    const indexes = fields.flatMap((field, index) => field.key === 'bytes' ? [index] : []);
    if (indexes.length !== 1) return skip('ambiguous_bytes');
    const index = indexes[0];
    const field = fields[index];
    removals.push(index < fields.length - 1 ? [field.start, fields[index + 1].start] : [index ? fields[index - 1].end : field.start, field.end]);
    entry.stages.push(stage.name);
  }
  let payload = row.payload;
  for (const [start, end] of removals.sort((a,b) => b[0] - a[0])) payload = payload.slice(0, start) + payload.slice(end);
  JSON.parse(payload);
  entry.after = digest(payload);entry.removedBytes = Buffer.byteLength(row.payload) - Buffer.byteLength(payload);
  entry.status = removals.length ? 'eligible' : 'noop';
  return {entry, payload, validUntilMicros};
}

export interface CleanupTransaction {
  read(id: string): Promise<RawJob | null>;
  active(id: string, now: number): Promise<boolean>;
  artifact(id: string, stage: string, now: number): Promise<CleanupArtifact | null>;
  updatePayload(id: string, payload: string): Promise<void>;
}
export interface CleanupStore {transaction<T>(action: (tx: CleanupTransaction) => Promise<T>): Promise<T>}

export async function createCleanupManifest(store: CleanupStore, ids: readonly string[], now: () => number): Promise<CleanupManifest> {
  const entries: CleanupEntry[] = [];
  for (const id of ids) {
    hash.parse(id);
    if (entries.some(entry => entry.id === id)) throw Error('duplicate_id');
    entries.push(await store.transaction(async tx => {
      const row = await tx.read(id);
      if (!row) return {id, expiresMicros:'0',before:digest(''),after:digest(''),removedBytes:0,stages:[],status:'skipped',reason:'missing'};
      return (await planMetadataCleanup(row, stage => tx.artifact(id, stage, now()), now(), await tx.active(id, now()))).entry;
    }));
  }
  return {version:1, entries};
}

export async function prepareCleanupBackup(store: CleanupStore, manifest: CleanupManifest, now: () => number): Promise<CleanupBackup> {
  const rows: RawJob[] = [];
  for (const entry of manifest.entries.filter(entry => entry.status === 'eligible')) {
    rows.push(await store.transaction(async tx => {
      const row = await tx.read(entry.id);
      if (!row) throw Error('job_changed');
      const plan = await planMetadataCleanup(row, stage => tx.artifact(row.id, stage, now()), now(), await tx.active(row.id, now()));
      if (JSON.stringify(plan.entry) !== JSON.stringify(entry)) throw Error('job_changed');
      return row;
    }));
  }
  return {version:1, manifest, rows};
}

export async function applyMetadataCleanup(store: CleanupStore, backup: CleanupBackup, now: () => number, restore = false): Promise<string[]> {
  cleanupBackupSchema.parse(backup);
  const changed: string[] = [];
  for (const entry of backup.manifest.entries.filter(entry => entry.status === 'eligible')) {
    const original = backup.rows.filter(row => row.id === entry.id);
    if (original.length !== 1 || digest(original[0].payload) !== entry.before || original[0].expiresMicros !== entry.expiresMicros) throw Error('invalid_backup');
  }
  for (const entry of backup.manifest.entries.filter(entry => entry.status === 'eligible')) {
    const original = backup.rows.find(row => row.id === entry.id)!;
    const updated = await store.transaction(async tx => {
      const row = await tx.read(entry.id);
      if (!row || row.expiresMicros !== entry.expiresMicros || BigInt(row.expiresMicros) <= BigInt(now())*BigInt(1000) || await tx.active(entry.id, now())) throw Error('job_changed');
      const plan = await planMetadataCleanup(original, stage => tx.artifact(row.id, stage, now()), now(), false);
      if (plan.entry.after !== entry.after || plan.entry.status !== 'eligible') throw Error('artifact_changed');
      const currentHash = digest(row.payload);
      const targetHash = restore ? entry.before : entry.after;
      if (currentHash === targetHash) return false;
      if (currentHash !== (restore ? entry.after : entry.before)) throw Error('job_changed');
      if (plan.validUntilMicros <= BigInt(now()) * BigInt(1000)) throw Error('job_changed');
      await tx.updatePayload(row.id, restore ? original.payload : plan.payload);
      return true;
    });
    if (updated) changed.push(entry.id);
  }
  return changed;
}
