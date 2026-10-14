import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";
import { applyRelatedPetsRelationPolicy } from "@/lib/pets/related-pets-relation-policy";

export function assertPositivePairIdentities(
  annotations: ReadonlyMap<string, ResolvedRelatedPetAnnotation>,
  pairs: readonly { left: string; right: string; relevant: boolean }[],
  relationPolicyRevision: string,
): void {
  // Verify the same effective identity graph that production ranking actually consumes.
  const effective = applyRelatedPetsRelationPolicy({ annotations, revision: relationPolicyRevision });
  for (const pair of pairs) {
    if (!pair.relevant) continue;
    const left = effective.get(pair.left), right = effective.get(pair.right);
    if (!left || !right) throw new Error("positive_pair_identity_unverified");
    const common = (left.entity && left.entity === right.entity) ||
      ["franchises", "franchiseFamilies"].some((key) => {
        const field = key as "franchises" | "franchiseFamilies";
        return left[field].some((value) => right[field].includes(value));
      });
    if (!common) throw new Error("positive_pair_identity_unverified");
  }
}
