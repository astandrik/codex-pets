import { z } from "zod";

export const HISTORY_PREFIX = "pets-generation-history-v1:";
const ID = /^[a-f0-9]{64}$/;
const DAY = 86_400_000;
const CLOCK_SKEW_MS = 5 * 60_000;
const EXPIRED_RETENTION_MS = 7 * DAY;
const MAX_ENTRIES = 50;
type ReadableHistoryStorage = Pick<Storage, "length" | "key" | "getItem">;
type PrunableHistoryStorage = ReadableHistoryStorage & Pick<Storage, "removeItem">;
type HistoryStorage = PrunableHistoryStorage & Pick<Storage, "setItem">;
const entrySchema = z.object({
  generationId: z.string().regex(ID),
  savedAt: z.number().finite().positive(),
  expiresAt: z.number().finite().positive(),
});
export type GenerationHistoryEntry = z.infer<typeof entrySchema>;

function scanGenerationHistory(now: number, storage: ReadableHistoryStorage) {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    .filter((key): key is string => key !== null && key.startsWith(HISTORY_PREFIX) && ID.test(key.slice(HISTORY_PREFIX.length)));
  const entries: GenerationHistoryEntry[] = [];
  const pruneKeys: string[] = [];
  for (const key of keys) {
    const entry = readStoredHistoryEntry(storage.getItem(key), key, now);
    if (!entry) continue;
    if (entry.expiresAt + EXPIRED_RETENTION_MS <= now) pruneKeys.push(key);
    else entries.push(entry);
  }
  entries.sort((a, b) => b.savedAt - a.savedAt || a.generationId.localeCompare(b.generationId));
  pruneKeys.push(...entries.slice(MAX_ENTRIES).map((entry) => HISTORY_PREFIX + entry.generationId));
  return { entries: entries.slice(0, MAX_ENTRIES), pruneKeys };
}

export function readGenerationHistory(
  now = Date.now(),
  storage?: ReadableHistoryStorage,
): { available: boolean; entries: GenerationHistoryEntry[] } {
  try {
    const { entries } = scanGenerationHistory(now, storage ?? window.localStorage);
    return { available: true, entries };
  } catch {
    return { available: false, entries: [] };
  }
}

function removeHistoryKeys(storage: PrunableHistoryStorage, keys: string[]) {
  for (const key of keys) {
    try { storage.removeItem(key); } catch {
      // Failed cleanup must not hide readable entries or undo a successful save.
    }
  }
}

// The result describes readable storage; individual deletions remain best-effort.
export function pruneGenerationHistory(now = Date.now(), storage?: PrunableHistoryStorage): boolean {
  try {
    const target = storage ?? window.localStorage;
    removeHistoryKeys(target, scanGenerationHistory(now, target).pruneKeys);
    return true;
  } catch {
    return false;
  }
}

function readStoredHistoryEntry(raw: string | null, key: string, now: number): GenerationHistoryEntry | null {
  if (!raw || raw.length > 1024) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = entrySchema.safeParse(value);
  if (!parsed.success) return null;
  const entry = parsed.data;
  if (
    entry.generationId !== key.slice(HISTORY_PREFIX.length) ||
    entry.savedAt > now + CLOCK_SKEW_MS ||
    entry.expiresAt > entry.savedAt + DAY + CLOCK_SKEW_MS
  ) return null;
  return entry;
}

export function rememberGeneration(
  generationId: string,
  expiresAt: string,
  now = Date.now(),
  storage?: HistoryStorage,
): boolean {
  try {
    const expires = Date.parse(expiresAt);
    if (!ID.test(generationId) || !Number.isFinite(expires) || expires <= now || expires > now + DAY + CLOCK_SKEW_MS) return false;
    const target = storage ?? window.localStorage;
    const history = scanGenerationHistory(now, target);
    removeHistoryKeys(target, history.pruneKeys);
    const previous = history.entries.find((entry) => entry.generationId === generationId);
    // Independent keys keep concurrent additions from different tabs from replacing each other.
    target.setItem(HISTORY_PREFIX + generationId, JSON.stringify({
      generationId, savedAt: previous?.savedAt ?? now, expiresAt: expires,
    }));
    return pruneGenerationHistory(now, target);
  } catch {
    return false;
  }
}

const historyGenerationSchema = z.object({
  generationId: z.string().regex(ID),
  status: z.enum(["queued", "generating", "awaiting_confirmation", "processing", "completed", "failed"]),
  expiresAt: z.iso.datetime(),
  progress: z.object({
    completedSteps: z.number().int().min(0).max(12), totalSteps: z.number().int().min(1).max(12),
  }).refine((value) => value.completedSteps <= value.totalSteps),
  pet: z.object({ displayName: z.string().min(1).max(80) }).optional(),
  error: z.object({ code: z.string().regex(/^[a-z_]{1,64}$/) }).optional(),
});
export type HistoryGeneration = z.infer<typeof historyGenerationSchema>;

export function parseHistoryGeneration(value: unknown, generationId: string): HistoryGeneration | null {
  const result = historyGenerationSchema.safeParse(value);
  return result.success && result.data.generationId === generationId ? result.data : null;
}
