import { describe, expect, it } from "vitest";

import {
  RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_REVISION,
  buildRelatedPetAnnotationInput,
  buildRelatedPetAnnotationText,
  createRelatedPetAnnotationEmbeddingSourceHash,
  createRelatedPetAnnotationSourceHash,
  parseRelatedPetAnnotationProposal,
  parseStoredRelatedPetAnnotationProposal,
  resolveRelatedPetAnnotation,
  listUnresolvedStrongRelations,
} from "@/lib/pets/related-pets-annotation-contract.mjs";
import {
  RELATED_PETS_ANNOTATION_ALIASES,
  RELATED_PETS_ANNOTATION_OVERRIDES,
} from "@/lib/pets/related-pets-annotation-control.mjs";

const pet = {
  slug: "vi",
  displayName: "Vi",
  description: "An Arcane fighter from Piltover.",
  kind: "character" as const,
  tags: ["Arcane", "anime", "public-domain"],
};

const proposal = {
  entity: {
    key: "Vi",
    aliases: ["Violet"],
    confidence: "high",
    evidence: ["name", "description"],
  },
  franchises: [relation("Arcane", "high", ["description"])],
  franchise_families: [
    relation("League of Legends", "high", ["world_knowledge"]),
  ],
  collections: [],
  specific_archetypes: [
    relation("Girl", "high", ["description"]),
    relation("Blue", "high", ["tag"]),
    relation("Cartoon", "high", ["description"]),
    relation("Punk Fighter", "high", ["description"]),
  ],
  themes: [relation("Rebellious Hero", "medium", ["description"])],
  media_origins: [relation("Animated Series", "medium", ["description"])],
};

describe("related pet V11 annotation contract", () => {
  it("keeps the corrected annotation family and audited overrides immutable", () => {
    expect([
      RELATED_PETS_ANNOTATION_REVISION,
      RELATED_PETS_ANNOTATION_QUERY_REVISION,
      RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
    ]).toEqual([
      "yandex-qwen3.6-35b-a3b-related-annotation-2026-08-v11-r4",
      "yandex-text-embeddings-v2-768-related-annotation-query-2026-08-v11-r4",
      "yandex-text-embeddings-v2-768-related-annotation-document-2026-08-v11-r4",
    ]);
    expect(Object.keys(RELATED_PETS_ANNOTATION_OVERRIDES).toSorted()).toEqual([
      "2b-2",
      "ashe",
      "ashe-detailed",
      "aurelia",
      "cheburashka",
      "chibi-wolf",
      "ffx-yuna",
      "fischl-detailed",
      "foggy-hedgehog",
      "frieren-2",
      "gordon-freeman",
      "jinx",
      "johnny",
      "karlson-2",
      "lady-d-2",
      "lain",
      "mai-shiranui",
      "master-of-terra",
      "maybe-baby-2-2",
      "megumin-3",
      "minty-codex-pet",
      "paprika-2",
      "round-bear",
      "ryuk-2",
      "sage-anime-girl",
      "sakura",
      "slaanesh",
      "sunny-sprout",
    ]);
  });

  it("canonicalizes the KonoSuba and Evangelion franchise IDs", () => {
    expect(RELATED_PETS_ANNOTATION_ALIASES.franchises).toMatchObject({
      "kono-suba": "konosuba",
      "neon-genesis-evangelion": "evangelion",
    });

    const annotationFor = (slug: string, franchise: string) =>
      resolveRelatedPetAnnotation({
        slug,
        proposal: {
          ...proposal,
          entity: {
            key: slug,
            aliases: [],
            confidence: "high",
            evidence: ["name"],
          },
          franchises: [relation(franchise, "high", ["description"])],
          franchise_families: [],
          specific_archetypes: [],
          themes: [],
          media_origins: [],
        },
      });

    expect(annotationFor("aqua", "Kono Suba").franchises).toEqual([
      "konosuba",
    ]);
    expect(annotationFor("aqua-2", "Konosuba").franchises).toEqual([
      "konosuba",
    ]);
    expect(annotationFor("asuka", "Evangelion").franchises).toEqual([
      "evangelion",
    ]);
    expect(
      annotationFor("rei-ayanami", "Neon Genesis Evangelion").franchises,
    ).toEqual(["evangelion"]);
  });

  it("removes operational collections from the nine audited cards", () => {
    for (const slug of [
      "ashe",
      "ashe-detailed",
      "aurelia",
      "gordon-freeman",
      "master-of-terra",
      "maybe-baby-2-2",
      "minty-codex-pet",
      "sage-anime-girl",
      "slaanesh",
    ]) {
      const resolved = resolveRelatedPetAnnotation({
        slug,
        proposal: {
          ...proposal,
          franchise_families: [],
          collections: [relation("codex", "high", ["tag"])],
        },
      });
      expect(resolved.collections, slug).toEqual([]);
    }
  });

  it("adds the two card-supported frozen-case facets", () => {
    const emptyProposal = {
      ...proposal,
      entity: { key: null, aliases: [], confidence: "none", evidence: [] },
      franchises: [],
      franchise_families: [],
      collections: [],
      specific_archetypes: [],
      themes: [],
      media_origins: [],
    };

    expect(resolveRelatedPetAnnotation({
      slug: "fischl-detailed",
      proposal: emptyProposal,
    })).toMatchObject({
      entity: "fischl",
      aliases: [],
      franchises: ["genshin-impact"],
    });
    expect(resolveRelatedPetAnnotation({
      slug: "lady-d-2",
      proposal: emptyProposal,
    }).specificArchetypes).toEqual(["vampire"]);
  });

  it("keeps ambiguous 2B and Lain relations card-supported", () => {
    const worldOnly = {
      ...proposal,
      franchises: [relation("hidden-franchise", "high", ["world_knowledge"])],
      franchise_families: [
        relation("hidden-family", "high", ["world_knowledge"]),
      ],
    };

    expect(listUnresolvedStrongRelations({
      slug: "2b-2",
      proposal: worldOnly,
    })).toEqual([]);
    expect(resolveRelatedPetAnnotation({
      slug: "2b-2",
      proposal: worldOnly,
    })).toMatchObject({
      entity: "2b",
      aliases: [],
      franchises: [],
      franchiseFamilies: [],
      specificArchetypes: ["android"],
    });
    expect(resolveRelatedPetAnnotation({
      slug: "lain",
      proposal: worldOnly,
    })).toMatchObject({
      entity: "lain",
      aliases: [],
      franchises: [],
      franchiseFamilies: [],
      themes: ["wired"],
    });
  });

  it("accepts only card-supported strong facets and blocks broad labels", () => {
    const resolved = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });

    expect(resolved).toEqual({
      schemaVersion: 1,
      entity: "vi",
      aliases: ["Violet"],
      franchises: ["arcane"],
      franchiseFamilies: [],
      collections: [],
      specificArchetypes: ["punk-fighter"],
      themes: ["rebellious-hero"],
      mediaOrigins: ["animated-series"],
    });
  });

  it("blocks broad entity proposals and strong override values", () => {
    const broadEntity = {
      ...proposal,
      entity: {
        key: "Girl",
        aliases: [],
        confidence: "high",
        evidence: ["description"],
      },
      franchise_families: [],
    };
    expect(resolveRelatedPetAnnotation({ slug: pet.slug, proposal: broadEntity }))
      .toMatchObject({ entity: null, aliases: [] });
    expect(() => resolveRelatedPetAnnotation({
      slug: pet.slug,
      proposal,
      overrides: {
        [pet.slug]: {
          reason: "Invalid generic override used by the regression test.",
          collections: ["anime"],
        },
      },
    })).toThrow(/collections contains a disallowed broad label/i);
  });

  it("applies field-replacement overrides and the frozen Soviet collection", () => {
    const empty = {
      ...proposal,
      entity: { key: null, aliases: [], confidence: "none", evidence: [] },
      franchises: [],
      franchise_families: [],
      specific_archetypes: [],
      themes: [],
      media_origins: [],
    };
    const resolved = resolveRelatedPetAnnotation({
      slug: "cheburashka",
      proposal: empty,
    });
    expect(resolved.collections).toEqual(["soviet-animation"]);
    expect(resolved.franchiseFamilies).toEqual([]);

    const replaced = resolveRelatedPetAnnotation({
      slug: "vi",
      proposal,
      overrides: {
        vi: {
          reason: "Verified from the card source.",
          entity: null,
          franchises: ["arcane-series"],
        },
      },
    });
    expect(replaced.entity).toBeNull();
    expect(replaced.franchises).toEqual(["arcane-series"]);
    expect(replaced.specificArchetypes).toEqual(["punk-fighter"]);
  });

  it("builds deterministic controlled text without raw description or tags", () => {
    const resolved = resolveRelatedPetAnnotation({ slug: pet.slug, proposal });
    const text = buildRelatedPetAnnotationText(resolved);
    expect(text).toContain("entity: vi");
    expect(text).toContain("franchises: arcane");
    expect(text).not.toContain(pet.description);
    expect(text).not.toContain("public-domain");
    expect(buildRelatedPetAnnotationInput(pet)).toBe(
      [
        "name: Vi",
        "kind: character",
        "description: An Arcane fighter from Piltover.",
        "tags: anime, arcane, public-domain",
      ].join("\n"),
    );
  });

  it("changes hashes only when their controlled inputs change", () => {
    const first = createRelatedPetAnnotationSourceHash({
      pet,
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
    });
    const same = createRelatedPetAnnotationSourceHash({
      pet: { ...pet, tags: pet.tags.toReversed() },
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
    });
    const changed = createRelatedPetAnnotationSourceHash({
      pet: { ...pet, description: `${pet.description} Updated.` },
      modelUri: "gpt://folder/qwen3.6-35b-a3b",
    });
    expect(same).toBe(first);
    expect(changed).not.toBe(first);

    const vectorHash = createRelatedPetAnnotationEmbeddingSourceHash({
      modelRevision: RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
      role: "document",
      annotationSourceHash: first,
      annotationText: "entity: vi",
    });
    expect(vectorHash).not.toBe(
      createRelatedPetAnnotationEmbeddingSourceHash({
        modelRevision: RELATED_PETS_ANNOTATION_DOCUMENT_REVISION,
        role: "query",
        annotationSourceHash: first,
        annotationText: "entity: vi",
      }),
    );
  });

  it("rejects schema drift and invalid confidence combinations", () => {
    expect(() => parseRelatedPetAnnotationProposal({ ...proposal, extra: [] }))
      .toThrow(/unknown field/i);
    expect(() => parseRelatedPetAnnotationProposal({
      ...proposal,
      entity: { key: null, aliases: [], confidence: "high", evidence: [] },
    })).toThrow(/confidence must be none/i);
  });

  it("parses the normalized proposal format stored in YDB", () => {
    const normalized = parseRelatedPetAnnotationProposal(proposal);
    expect(parseStoredRelatedPetAnnotationProposal(
      JSON.parse(JSON.stringify(normalized)),
    )).toEqual(normalized);
  });

  it("requires an explicit override for world-knowledge-only strong facets", () => {
    expect(listUnresolvedStrongRelations({ slug: pet.slug, proposal }))
      .toEqual(["franchiseFamilies"]);
    expect(listUnresolvedStrongRelations({
      slug: pet.slug,
      proposal,
      overrides: {
        [pet.slug]: {
          reason: "Verified against the source card before calibration.",
          franchiseFamilies: ["league-of-legends"],
        },
      },
    })).toEqual([]);
  });

  it("does not copy aliases from an unverified entity into controlled text", () => {
    const worldOnly = {
      ...proposal,
      entity: {
        key: "Vi",
        aliases: ["Violet"],
        confidence: "medium",
        evidence: ["world_knowledge"],
      },
      franchise_families: [],
      themes: [],
    };
    const resolved = resolveRelatedPetAnnotation({
      slug: pet.slug,
      proposal: worldOnly,
      overrides: {
        [pet.slug]: {
          reason: "The proposal is intentionally not promoted.",
          entity: null,
        },
      },
    });
    expect(resolved.entity).toBeNull();
    expect(resolved.aliases).toEqual([]);
  });

  it("requires overrides for weak world-knowledge-only values too", () => {
    const worldOnlyTheme = {
      ...proposal,
      franchise_families: [],
      themes: [relation("Action", "medium", ["world_knowledge"])],
    };
    expect(listUnresolvedStrongRelations({
      slug: pet.slug,
      proposal: worldOnlyTheme,
    })).toEqual(["themes"]);
  });
});

function relation(
  key: string,
  confidence: "high" | "medium" | "none",
  evidence: Array<"name" | "description" | "tag" | "world_knowledge">,
) {
  return { key, confidence, evidence };
}
