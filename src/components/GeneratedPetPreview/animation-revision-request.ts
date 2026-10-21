import {z} from "zod";
import {animationRevisionInputSchema, animationStatesSchema} from "@/lib/pets/generation/animation-revision-input";

const PREFIX = "pets-animation-revision-v1:";
const pendingSchema = z.object({requestId: z.uuid(), states: animationStatesSchema, sourceMetadataRevision: z.number().int().nonnegative(), hash: z.string().regex(/^[a-f0-9]{64}$/), expiresAt: z.number().finite()}).strict();
export type PendingAnimationRevision = z.infer<typeof pendingSchema>;
type RequestStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function readAnimationRevision(storage: Pick<Storage, "getItem">, sourceId: string, now = Date.now()) {
  const raw = storage.getItem(PREFIX + sourceId);
  if (!raw || raw.length > 2048) return null;
  try {
    const result = pendingSchema.safeParse(JSON.parse(raw));
    return result.success && result.data.expiresAt > now ? result.data : null;
  } catch {return null;}
}
export function clearAnimationRevision(storage: RequestStorage, sourceId: string, requestId: string) {
  if (readAnimationRevision(storage, sourceId)?.requestId === requestId) storage.removeItem(PREFIX + sourceId);
}
export async function prepareAnimationRevision(storage: RequestStorage, sourceId: string, brief: {states: string[]; prompt?: string; sourceMetadataRevision: number}, now = Date.now()) {
  const parsed = animationRevisionInputSchema.parse({...brief, requestId: crypto.randomUUID()});
  const content = {states: parsed.states, prompt: parsed.prompt || "", sourceMetadataRevision: parsed.sourceMetadataRevision};
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(content)));
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  const previous = readAnimationRevision(storage, sourceId, now);
  if (previous && previous.hash !== hash) throw Error("animation_revision_replay_mismatch");
  const requestId = previous?.requestId ?? parsed.requestId;
  if (!previous) storage.setItem(PREFIX + sourceId, JSON.stringify({requestId, states: parsed.states, sourceMetadataRevision: parsed.sourceMetadataRevision, hash, expiresAt: now + 2 * 86400000}));
  return {input: {...content, requestId}, isNew: !previous, clear: () => {
    if (readAnimationRevision(storage, sourceId, now)?.requestId === requestId) storage.removeItem(PREFIX + sourceId);
  }};
}
