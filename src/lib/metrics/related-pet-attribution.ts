import { RELATED_PETS_SNAPSHOT_DEPTH } from "@/lib/pets/related-pets-limits";

export type RelatedPetContext = {
  sourceSlug: string;
  targetSlug: string;
  position: number;
};

type StoredRelatedPetAttribution = RelatedPetContext & {
  clickedAt: number;
};

export const RELATED_PET_ATTRIBUTION_TTL_MS = 30 * 60 * 1000;
export const RELATED_PET_ATTRIBUTION_STORAGE_KEY =
  "codex-pets:related-pet-attribution";

const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,47}$/;

export function storeRelatedPetAttribution(
  context: RelatedPetContext,
  now = Date.now(),
): void {
  if (!isRelatedPetContext(context) || !Number.isFinite(now)) return;

  try {
    window.sessionStorage.setItem(
      RELATED_PET_ATTRIBUTION_STORAGE_KEY,
      JSON.stringify({ ...context, clickedAt: now }),
    );
  } catch {
    // Attribution is best-effort and must never block navigation.
  }
}

export function readRelatedPetAttribution(
  targetSlug: string,
  now = Date.now(),
): RelatedPetContext | null {
  if (!SAFE_SLUG.test(targetSlug) || !Number.isFinite(now)) return null;

  try {
    const raw = window.sessionStorage.getItem(
      RELATED_PET_ATTRIBUTION_STORAGE_KEY,
    );
    if (!raw) return null;

    const stored = JSON.parse(raw) as unknown;
    if (!isStoredAttribution(stored, now)) {
      window.sessionStorage.removeItem(RELATED_PET_ATTRIBUTION_STORAGE_KEY);
      return null;
    }
    if (stored.targetSlug !== targetSlug) return null;

    return {
      sourceSlug: stored.sourceSlug,
      targetSlug: stored.targetSlug,
      position: stored.position,
    };
  } catch {
    try {
      window.sessionStorage.removeItem(RELATED_PET_ATTRIBUTION_STORAGE_KEY);
    } catch {}
    return null;
  }
}

export function getRelatedPetGoalParams(context: RelatedPetContext) {
  return {
    source_slug: context.sourceSlug,
    target_slug: context.targetSlug,
    position: context.position,
    origin: "related_pet" as const,
  };
}

function isRelatedPetContext(value: unknown): value is RelatedPetContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<RelatedPetContext>;
  return (
    typeof context.sourceSlug === "string" &&
    SAFE_SLUG.test(context.sourceSlug) &&
    typeof context.targetSlug === "string" &&
    SAFE_SLUG.test(context.targetSlug) &&
    context.sourceSlug !== context.targetSlug &&
    typeof context.position === "number" &&
    Number.isSafeInteger(context.position) &&
    context.position >= 1 &&
    context.position <= RELATED_PETS_SNAPSHOT_DEPTH
  );
}

function isStoredAttribution(
  value: unknown,
  now: number,
): value is StoredRelatedPetAttribution {
  if (!isRelatedPetContext(value)) return false;
  const clickedAt = (value as Partial<StoredRelatedPetAttribution>).clickedAt;
  if (typeof clickedAt !== "number" || !Number.isFinite(clickedAt)) {
    return false;
  }

  const age = now - clickedAt;
  return age >= 0 && age <= RELATED_PET_ATTRIBUTION_TTL_MS;
}
