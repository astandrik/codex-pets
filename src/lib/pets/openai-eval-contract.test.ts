import { describe, expect, it } from "vitest";
import { assertPositivePairIdentities } from "@/lib/pets/openai-eval-contract";
import { RELATED_PETS_V24_RELATION_POLICY_REVISION } from "@/lib/pets/related-pets-relation-policy";
import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";
const empty: ResolvedRelatedPetAnnotation = { schemaVersion: 1, entity: null, aliases: [], franchises: [], franchiseFamilies: [], collections: [], specificArchetypes: [], themes: [], mediaOrigins: [] };
describe("frozen pair identity gate", () => {
  it("applies the existing production Arcane/League family policy before the same hard gate", () => {
    const annotations = new Map([
      ["jinx", { ...empty, entity: "jinx", franchises: ["league-of-legends"] }],
      ["jinx-2", { ...empty, entity: "jinx-2", franchises: ["arcane"] }],
    ]);
    expect(() => assertPositivePairIdentities(annotations, [{ left: "jinx", right: "jinx-2", relevant: true }], RELATED_PETS_V24_RELATION_POLICY_REVISION)).not.toThrow();
    expect(annotations.get("jinx-2")?.franchiseFamilies).toEqual([]);
  });
  it("continues to reject unrelated, missing and unknown-policy identities", () => {
    const annotations = new Map([
      ["jinx", { ...empty, entity: "jinx", franchises: ["league-of-legends"] }],
      ["amber", { ...empty, entity: "amber", franchises: ["genshin-impact"] }],
    ]);
    const pairs = [{ left: "jinx", right: "amber", relevant: true }];
    expect(() => assertPositivePairIdentities(annotations, pairs, RELATED_PETS_V24_RELATION_POLICY_REVISION)).toThrow("positive_pair_identity_unverified");
    expect(() => assertPositivePairIdentities(new Map(), pairs, RELATED_PETS_V24_RELATION_POLICY_REVISION)).toThrow("positive_pair_identity_unverified");
    expect(() => assertPositivePairIdentities(annotations, pairs, "unknown")).toThrow();
  });
});
