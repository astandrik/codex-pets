import { describe, expect, it } from "vitest";

import type { ResolvedRelatedPetAnnotation } from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  applyRelatedPetsRelationPolicy,
  RELATED_PETS_V24_FAMILY_PARENTS,
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

describe("V24 relation policy", () => {
  it("adds the verified Primaris franchise without mutating stored data", () => {
    expect(applyRelatedPetsRelationPolicy({
      annotations: new Map([["primaris", annotation]]),
      revision: RELATED_PETS_V24_RELATION_POLICY_REVISION,
    }).get("primaris")).toEqual({ ...annotation, franchises: ["warhammer-40000"] });
    expect(annotation.franchises).toEqual([]);
  });

  it("is a no-op without a policy and for unrelated pets", () => {
    const annotations = new Map([["primaris", annotation]]);
    expect(applyRelatedPetsRelationPolicy({ annotations })).toBe(annotations);
    expect(applyRelatedPetsRelationPolicy({
      annotations: new Map([["guardian", annotation]]),
      revision: RELATED_PETS_V24_RELATION_POLICY_REVISION,
    }).get("guardian")).toBe(annotation);
  });

  it("fails closed for an unknown revision", () => {
    expect(() => applyRelatedPetsRelationPolicy({
      annotations: new Map([["primaris", annotation]]),
      revision: "unknown",
    })).toThrow("Unsupported related-pets relation policy revision.");
  });

  it("fails closed for an empty supplied revision", () => {
    expect(() => applyRelatedPetsRelationPolicy({
      annotations: new Map([["primaris", annotation]]),
      revision: "",
    })).toThrow("Unsupported related-pets relation policy revision.");
  });

  it("pins one typed global parent relation rather than per-pet exceptions", () => {
    expect(RELATED_PETS_V24_FAMILY_PARENTS).toEqual({ arcane: "league-of-legends" });
    expect(RELATED_PETS_V24_RELATION_POLICY_REVISION)
      .toBe("related-pets-relation-policy-2026-08-v24-r2");
  });

  it("adds shared families without equating franchises or entities", () => {
    const series = {
      ...annotation, entity: "series-hero", aliases: ["Hero"],
      franchises: ["arcane"], franchiseFamilies: ["original-family"],
    };
    const game = { ...annotation, entity: "game-hero", franchises: ["league-of-legends"] };
    const input = new Map([["series", series], ["game", game]]);
    const result = apply(input);
    expect(result.get("series")).toEqual({
      ...series, franchiseFamilies: ["league-of-legends", "original-family"],
    });
    expect(result.get("game")).toEqual({ ...game, franchiseFamilies: ["league-of-legends"] });
    expect(series.franchiseFamilies).toEqual(["original-family"]);
  });

  it("derives known installment roots and preserves the original family key", () => {
    const result = apply(new Map([
      ["root", { ...annotation, franchiseFamilies: ["star-quest"] }],
      ["roman", { ...annotation, franchises: ["star-quest-iv"], franchiseFamilies: ["star-quest-iv"] }],
      ["arabic", { ...annotation, franchises: ["star-quest-12"] }],
    ]));
    expect(result.get("roman")?.franchiseFamilies).toEqual(["star-quest", "star-quest-iv"]);
    expect(result.get("arabic")?.franchiseFamilies).toEqual(["star-quest"]);
    expect(result.get("roman")?.franchises).toEqual(["star-quest-iv"]);
  });

  it("uses existing family aliases without rewriting franchise identifiers", () => {
    const result = apply(new Map([
      ["short-name", { ...annotation, franchises: ["ffx"] }],
    ]));
    expect(result.get("short-name")).toEqual({
      ...annotation, franchises: ["ffx"], franchiseFamilies: ["final-fantasy"],
    });
  });

  it.each(["unknown-iv", "star-quest-iiii", "star-quest-other"])(
    "does not invent a parent for %s",
    (franchise) => {
      const result = apply(new Map([
        ["root", { ...annotation, franchiseFamilies: ["star-quest"] }],
        ["unknown", { ...annotation, franchises: [franchise] }],
      ]));
      expect(result.get("unknown")?.franchiseFamilies).toEqual([]);
    },
  );

  it("respects authoritative whole-field annotation overrides", () => {
    const protectedAnnotation = { ...annotation, franchises: ["arcane"] };
    expect(apply(new Map([["cheburashka", protectedAnnotation]]))
      .get("cheburashka")).toBe(protectedAnnotation);
  });

  it("does not infer a relation from crossovers or an unknown annotation", () => {
    const result = apply(new Map([
      ["crossover", { ...annotation, franchises: ["arcane", "other-world"] }],
      ["other", { ...annotation, franchises: ["other-world"] }],
      ["unknown", annotation],
    ]));
    expect(result.get("crossover")?.franchiseFamilies).toEqual(["league-of-legends"]);
    expect(result.get("other")?.franchiseFamilies).toEqual([]);
    expect(result.get("unknown")).toBe(annotation);
  });

  it("does not interpret object-prototype names as aliases or overrides", () => {
    const record = { ...annotation, franchises: ["constructor"] };
    expect(apply(new Map([["constructor", record]])).get("constructor")).toBe(record);
  });

  it("is deterministic, idempotent and independent of unprotected slugs", () => {
    const entries: Array<[string, ResolvedRelatedPetAnnotation]> = [
      ["first", { ...annotation, franchises: ["arcane"] }],
      ["second", { ...annotation, franchises: ["final-fantasy-x"] }],
    ];
    const original = structuredClone(entries);
    const result = apply(new Map(entries));
    expect(apply(result)).toEqual(result);
    const reversed = apply(new Map([...entries].reverse()));
    for (const [slug, value] of result) expect(reversed.get(slug)).toEqual(value);
    expect([...apply(new Map(entries.map(([slug, value]) => ["renamed-" + slug, value]))).values()])
      .toEqual([...result.values()]);
    expect(entries).toEqual(original);
  });
});

function apply(annotations: ReadonlyMap<string, ResolvedRelatedPetAnnotation>) {
  return applyRelatedPetsRelationPolicy({
    annotations,
    revision: RELATED_PETS_V24_RELATION_POLICY_REVISION,
  });
}
