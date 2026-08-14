import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";

export const RELATED_PETS_V23_RELATION_POLICY_REVISION =
  "related-pets-relation-policy-2026-08-v23-r1";

type RelationOverride = {
  reason: string;
  franchises: readonly string[];
};

export const RELATED_PETS_V23_RELATION_OVERRIDES: Readonly<
  Record<string, RelationOverride>
> = Object.freeze({
  primaris: Object.freeze({
    reason:
      "The card identifies a Warhammer-inspired Space Marine, and Games Workshop identifies Primaris Space Marines with Warhammer 40,000.",
    franchises: Object.freeze(["warhammer-40000"]),
  }),
});

export function applyRelatedPetsRelationPolicy(input: {
  slug: string;
  annotation: ResolvedRelatedPetAnnotation | null;
  revision?: string;
}): ResolvedRelatedPetAnnotation | null {
  if (!input.revision) return input.annotation;
  if (input.revision !== RELATED_PETS_V23_RELATION_POLICY_REVISION) {
    throw new Error("Unsupported related-pets relation policy revision.");
  }

  const override = RELATED_PETS_V23_RELATION_OVERRIDES[input.slug];
  if (!input.annotation || !override) return input.annotation;
  return {
    ...input.annotation,
    franchises: [...override.franchises],
  };
}
