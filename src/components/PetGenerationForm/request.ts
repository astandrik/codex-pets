export const REQUEST_STORAGE_KEY = "pets-generation-request";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type Brief = { prompt: string; displayName?: string; referenceImage?: Blob; sourceBaseId?: string; replayOnly?: boolean };
type SavedRequest = {hash: string; requestId: string; expiresAt: number};

async function digest(bytes: BufferSource) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function requestKey(sourceBaseId?: string) {
  return sourceBaseId ? REQUEST_STORAGE_KEY + ":" + await digest(new TextEncoder().encode(sourceBaseId)) : REQUEST_STORAGE_KEY;
}

function readRequest(storage: Pick<Storage, "getItem">, key: string, now: number): SavedRequest | null {
  try {
    const previous: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (previous && typeof previous === "object" && "hash" in previous && typeof previous.hash === "string" && /^[a-f0-9]{64}$/.test(previous.hash) &&
        "expiresAt" in previous && typeof previous.expiresAt === "number" && Number.isFinite(previous.expiresAt) && previous.expiresAt > now &&
        "requestId" in previous && typeof previous.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(previous.requestId)) {
      return {hash: previous.hash, requestId: previous.requestId, expiresAt: previous.expiresAt};
    }
  } catch { /* Ignore corrupt local metadata, never the subsequent write failure. */ }
  return null;
}

export async function hasPendingRefinement(storage: Pick<Storage, "getItem">, sourceBaseId: string, now = Date.now()) {
  return readRequest(storage, await requestKey(sourceBaseId), now) !== null;
}

export async function clearRefinementRequest(storage: Pick<globalThis.Storage, "removeItem">, sourceBaseId: string) {
  storage.removeItem(await requestKey(sourceBaseId));
}

export async function prepareGenerationRequest(storage: Storage, brief: Brief, now = Date.now()) {
  const content = { prompt: brief.prompt.trim(), ...(brief.displayName?.trim() ? { displayName: brief.displayName.trim() } : {}) };
  const referenceSha256 = brief.referenceImage ? await digest(await brief.referenceImage.arrayBuffer()) : undefined;
  const hash = await digest(new TextEncoder().encode(JSON.stringify({...content, ...(referenceSha256 ? {referenceSha256} : {}), ...(brief.sourceBaseId ? {sourceBaseId: brief.sourceBaseId} : {})})));
  const key = await requestKey(brief.sourceBaseId);
  const previous = readRequest(storage, key, now);
  const matching = previous?.hash === hash ? previous : null;
  // A pending refinement may already be charged; different text must not replace its recovery identity.
  if ((brief.replayOnly || (brief.sourceBaseId && previous)) && !matching) throw new Error("refinement_replay_mismatch");
  const requestId = matching?.requestId ?? crypto.randomUUID();
  if (!brief.replayOnly && !(brief.sourceBaseId && matching)) storage.setItem(key, JSON.stringify({ hash, requestId, expiresAt: now + 86_400_000 }));
  return { ...content, requestId };
}

export function startNewGeneration(storage: Pick<globalThis.Storage, "removeItem"> = sessionStorage) {
  storage.removeItem(REQUEST_STORAGE_KEY);
}
