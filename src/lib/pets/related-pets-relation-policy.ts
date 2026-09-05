import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  RELATED_PETS_ANNOTATION_ALIASES,
  RELATED_PETS_ANNOTATION_OVERRIDES,
} from "@/lib/pets/related-pets-annotation-control.mjs";

export const RELATED_PETS_V24_RELATION_POLICY_REVISION =
  "related-pets-relation-policy-2026-08-v24-r2";

// Registry changes require a new relation-policy revision, not new embeddings.
export const RELATED_PETS_V24_FAMILY_PARENTS: Readonly<Record<string, string>> =
  Object.freeze({
    // Riot identifies Arcane as part of the League IP, not an identical franchise:
    // https://www.riotgames.com/en/news/riot-games-announces-new-equity-investment-in-arcane-animation-studio-fortiche-production
    arcane: "league-of-legends",
  });

const NUMBERED_INSTALLMENT =
  /^(.*)-(\d+|(?=[ivxlcdm]+$)m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3}))$/;

function installmentRoot(key: string): string | null {
  const match = NUMBERED_INSTALLMENT.exec(key);
  return match?.[2] ? match[1] : null;
}

type RelationOverride = {
  reason: string;
  franchises: readonly string[];
};

export const RELATED_PETS_V24_RELATION_OVERRIDES: Readonly<
  Record<string, RelationOverride>
> = Object.freeze({
  primaris: Object.freeze({
    reason:
      "The card identifies a Warhammer-inspired Space Marine, and Games Workshop identifies Primaris Space Marines with Warhammer 40,000.",
    franchises: Object.freeze(["warhammer-40000"]),
  }),
});

export function applyRelatedPetsRelationPolicy(input: {
  annotations: ReadonlyMap<string, ResolvedRelatedPetAnnotation>;
  revision?: string;
}): ReadonlyMap<string, ResolvedRelatedPetAnnotation> {
  if (input.revision === undefined) return input.annotations;
  if (input.revision !== RELATED_PETS_V24_RELATION_POLICY_REVISION) {
    throw new Error("Unsupported related-pets relation policy revision.");
  }

  const annotations = [...input.annotations.values()];
  const familyAliases = new Map(
    Object.entries(RELATED_PETS_ANNOTATION_ALIASES.franchiseFamilies),
  );
  const roots = new Set([
    ...familyAliases.values(),
    ...Object.values(RELATED_PETS_V24_FAMILY_PARENTS),
    ...annotations.flatMap(({ franchiseFamilies }) =>
      franchiseFamilies.filter((key) => installmentRoot(key) === null)
    ),
  ]);
  const parents = new Map(Object.entries(RELATED_PETS_V24_FAMILY_PARENTS));
  for (const annotation of annotations) {
    for (const key of [...annotation.franchises, ...annotation.franchiseFamilies]) {
      const root = installmentRoot(key);
      const parent = familyAliases.get(key) ?? (root && roots.has(root) ? root : null);
      if (!parent || parent === key) continue;
      if (parents.has(key) && parents.get(key) !== parent) {
        throw new Error("Conflicting related-pets family parents.");
      }
      parents.set(key, parent);
    }
  }
  const ancestors = new Map<string, readonly string[]>();
  for (const key of new Set([...roots, ...parents.keys()])) {
    const values = new Set<string>();
    const seen = new Set([key]);
    if (roots.has(key)) values.add(key);
    let parent = parents.get(key);
    while (parent !== undefined) {
      if (seen.has(parent)) throw new Error("Cyclic related-pets family parents.");
      seen.add(parent);
      values.add(parent);
      parent = parents.get(parent);
    }
    ancestors.set(key, [...values]);
  }

  const result = new Map<string, ResolvedRelatedPetAnnotation>();
  for (const [slug, annotation] of input.annotations) {
    let effective = annotation;
    if (!Object.hasOwn(RELATED_PETS_ANNOTATION_OVERRIDES[slug] ?? {}, "franchiseFamilies")) {
      const families = [...new Set([
        ...annotation.franchiseFamilies,
        ...[...annotation.franchises, ...annotation.franchiseFamilies]
          .flatMap((key) => ancestors.get(key) ?? []),
      ])].sort();
      if (
        families.length !== annotation.franchiseFamilies.length ||
        families.some((key, index) => key !== annotation.franchiseFamilies[index])
      ) {
        effective = { ...annotation, franchiseFamilies: families };
      }
    }
    const override = Object.hasOwn(RELATED_PETS_V24_RELATION_OVERRIDES, slug)
      ? RELATED_PETS_V24_RELATION_OVERRIDES[slug]
      : undefined;
    result.set(slug, override
      ? { ...effective, franchises: [...override.franchises] }
      : effective);
  }
  return result;
}
