import { describe, expect, it } from "vitest";

import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  applyRelatedPetsRelationPolicy,
  RELATED_PETS_V24_RELATION_POLICY_REVISION,
} from "@/lib/pets/related-pets-relation-policy";

const annotation: ResolvedRelatedPetAnnotation = {
  schemaVersion: 1,
  entity: null,
  aliases: [],
  franchises: [],
  franchiseFamilies: [],
  collections: [],
  specificArchetypes: [],
  themes: [],
  mediaOrigins: [],
};

describe("current related-pets relation policy", () => {
  it("adds the verified Primaris franchise without mutating stored data", () => {
    const result = applyRelatedPetsRelationPolicy({
      slug: "primaris",
      annotation,
      revision: RELATED_PETS_V24_RELATION_POLICY_REVISION,
    });

    expect(result).toEqual({
      ...annotation,
      franchises: ["warhammer-40000"],
    });
    expect(annotation.franchises).toEqual([]);
  });

  it("is a no-op without a policy and for unrelated pets", () => {
    expect(applyRelatedPetsRelationPolicy({
      slug: "primaris",
      annotation,
    })).toBe(annotation);
    expect(applyRelatedPetsRelationPolicy({
      slug: "guardian",
      annotation,
      revision: RELATED_PETS_V24_RELATION_POLICY_REVISION,
    })).toBe(annotation);
  });

  it("fails closed for an unknown revision", () => {
    expect(() => applyRelatedPetsRelationPolicy({
      slug: "primaris",
      annotation,
      revision: "related-pets-relation-policy-unknown",
    })).toThrow("Unsupported related-pets relation policy revision.");
  });
});
