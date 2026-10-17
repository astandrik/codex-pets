export const REQUEST_STORAGE_KEY = "pets-generation-request";
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
type Brief = { prompt: string; displayName?: string; referenceImage?: Blob };
export async function prepareGenerationRequest(storage: Storage, brief: Brief, now = Date.now()) {
  const content = { prompt: brief.prompt.trim(), ...(brief.displayName?.trim() ? { displayName: brief.displayName.trim() } : {}) };
  const referenceSha256 = brief.referenceImage ? Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await brief.referenceImage.arrayBuffer())), byte => byte.toString(16).padStart(2,"0")).join("") : undefined;
  const bytes = new TextEncoder().encode(JSON.stringify({...content, ...(referenceSha256 ? {referenceSha256} : {})}));
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), byte => byte.toString(16).padStart(2,"0")).join("");
  let requestId = crypto.randomUUID();
  try {
    const previous: unknown = JSON.parse(storage.getItem(REQUEST_STORAGE_KEY) ?? "null");
    if (previous && typeof previous === "object" && "hash" in previous && previous.hash === hash && "expiresAt" in previous && typeof previous.expiresAt === "number" && previous.expiresAt > now && "requestId" in previous && typeof previous.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(previous.requestId)) requestId = previous.requestId as `${string}-${string}-${string}-${string}-${string}`;
  } catch { /* Ignore corrupt local metadata, never the subsequent write failure. */ }
  storage.setItem(REQUEST_STORAGE_KEY, JSON.stringify({ hash, requestId, expiresAt: now + 86_400_000 }));
  return { ...content, requestId };
}

export function startNewGeneration(storage: Pick<globalThis.Storage, "removeItem"> = sessionStorage) {
  storage.removeItem(REQUEST_STORAGE_KEY);
}
