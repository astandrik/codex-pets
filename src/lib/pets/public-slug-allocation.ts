import { randomUUID } from "node:crypto";
import { appendPublicPetSlugSuffix } from "@/lib/pets/public-slug";

export class PublicPetSlugUnavailableError extends Error {
  constructor() { super("No public pet slug is available in the bounded candidate set."); }
}

export async function findAvailablePublicPetSlug(
  base: string,
  listTakenSlugs: (slugs: string[]) => Promise<string[]>,
  options: { maxLength?: number; randomSuffix?: () => string } = {},
): Promise<{ available: boolean; suggestedSlug: string }> {
  const maxLength = options.maxLength ?? 64;
  const randomSuffix = options.randomSuffix ?? (() => randomUUID().replace(/-/g, "").slice(0, 8));
  const suffixBase = base.slice(0, maxLength).replace(/-+$/g, "");
  const candidates = [...new Set([
    base,
    ...Array.from({ length: 98 }, (_, index) => appendPublicPetSlugSuffix(suffixBase, String(index + 2), maxLength)),
    ...Array.from({ length: 5 }, () => appendPublicPetSlugSuffix(suffixBase, randomSuffix(), maxLength)),
  ])];
  const taken = new Set(await listTakenSlugs(candidates));
  const suggestedSlug = candidates.find(slug => !taken.has(slug));
  if (!suggestedSlug) throw new PublicPetSlugUnavailableError();
  return { available: !taken.has(base), suggestedSlug };
}
