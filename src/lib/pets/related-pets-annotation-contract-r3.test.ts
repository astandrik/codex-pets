import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
  RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
  RELATED_PETS_ANNOTATION_QUERY_REVISION,
  RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
  RELATED_PETS_ANNOTATION_SCHEMA_NAME,
  RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS,
  RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
  RELATED_PETS_ANNOTATION_TOKEN_POLICY,
  RELATED_PETS_ANNOTATION_USER_PROMPT,
  RELATED_PETS_ANNOTATION_WRITE_PROPOSAL_REVISION,
  createRelatedPetAnnotationEmbeddingSourceHash,
  createRelatedPetAnnotationProposalHash,
  createRelatedPetAnnotationProposalInputHash,
  createRelatedPetAnnotationSourceHash,
  getRelatedPetAnnotationProposalContract,
  parseRelatedPetAnnotationProposal,
  parseStoredRelatedPetAnnotationProposal,
} from "@/lib/pets/related-pets-annotation-contract.mjs";

const pet = {
  slug: "vi",
  displayName: "Vi",
  description: "Arcane fighter",
  kind: "character" as const,
  tags: ["arcane"],
};

const rawProposal = {
  entity: { key: "Vi", aliases: [], confidence: "high", evidence: ["name"] },
  franchises: [],
  franchise_families: [],
  collections: [],
  specific_archetypes: [],
  themes: [],
  media_origins: [],
};

const r3Proposal = {
  entity: { key: "vi", aliases: [], confidence: "high", evidence: ["name"] },
  franchises: [relation("arcane")],
  franchise_families: [relation("league-of-legends")],
  collections: [relation("piltover-champions")],
  specific_archetypes: [relation("punk-fighter")],
  themes: [relation("rebellious-hero")],
  media_origins: [relation("animated-series")],
};

describe("versioned related pet annotation proposal contract", () => {
  it("keeps the R2 wire contract and golden hashes byte-stable", () => {
    const contract = getRelatedPetAnnotationProposalContract(
      RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
    );

    expect(contract).toEqual({
      revision: RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      schemaName: RELATED_PETS_ANNOTATION_SCHEMA_NAME,
      schema: RELATED_PETS_ANNOTATION_RESPONSE_JSON_SCHEMA,
      systemPrompt: RELATED_PETS_ANNOTATION_SYSTEM_PROMPT,
      userPrompt: RELATED_PETS_ANNOTATION_USER_PROMPT,
      tokenPolicy: RELATED_PETS_ANNOTATION_TOKEN_POLICY,
    });
    expect(createHash("sha256").update(JSON.stringify(contract.schema)).digest("hex"))
      .toBe("6ea82559d96eeede4e045ba034b1b8bef24714bc7f144f110780a75c612837f5");

    const proposalInputHash = createRelatedPetAnnotationProposalInputHash({
      pet,
      modelUri: "gpt://fixture/qwen3.6-35b-a3b",
    });
    const proposal = parseRelatedPetAnnotationProposal(rawProposal);
    const proposalHash = createRelatedPetAnnotationProposalHash(proposal);
    const sourceHash = createRelatedPetAnnotationSourceHash({
      slug: pet.slug,
      proposalInputHash,
      proposalHash,
    });
    expect(proposalInputHash).toBe("108014a62dfc0e176a950e1d86ab5cd0885f63634e109d77fc55a286664902d4");
    expect(proposalHash).toBe("30423dbc4ceef602abb64a0bd46d0ff350fa888ce231b0f4f6a6a9051b5a103c");
    expect(sourceHash).toBe("0b0053990dd5fcc2f563229c961b005c94bd21a234ebc03342d30cae89b9b8b0");
    expect(createRelatedPetAnnotationEmbeddingSourceHash({
      modelRevision: RELATED_PETS_ANNOTATION_QUERY_REVISION,
      role: "query",
      annotationSourceHash: sourceHash,
      annotationText: "entity: vi",
    })).toBe("004fef616531a57a290f814124250b8fae05fc5618863463f891f6e3d2383537");
  });

  it("selects an R3 schema and prompt that constrain every wire identifier", () => {
    const r2 = getRelatedPetAnnotationProposalContract(RELATED_PETS_ANNOTATION_PROPOSAL_REVISION);
    const r3 = getRelatedPetAnnotationProposalContract(RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3);
    const schema = r3.schema as {
      properties: Record<string, { properties?: { key?: object }; items?: { properties: { key: object } } }>;
    };

    expect(RELATED_PETS_ANNOTATION_WRITE_PROPOSAL_REVISION).toBe(
      RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
    );
    expect(RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS).toEqual([
      RELATED_PETS_ANNOTATION_PROPOSAL_REVISION,
      RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
    ]);
    expect(Object.isFrozen(RELATED_PETS_ANNOTATION_SUPPORTED_PROPOSAL_REVISIONS)).toBe(true);
    expect(r3.schemaName).toBe("related_pet_annotation_v11_r13");
    expect(r3.systemPrompt).toBe(
      `${r2.systemPrompt} Use lowercase ASCII keys matching ^[a-z0-9]+(?:-[a-z0-9]+)*$ exactly; use null for entity.key when identity is unknown. Do not invent an identity.`,
    );
    expect(r3.userPrompt).toBe(r2.userPrompt);
    expect(r3.tokenPolicy).toBe(r2.tokenPolicy);
    expect(schema.properties.entity.properties?.key).toEqual({
      type: ["string", "null"],
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
    });
    for (const field of [
      "franchises",
      "franchise_families",
      "collections",
      "specific_archetypes",
      "themes",
      "media_origins",
    ]) {
      expect(schema.properties[field]?.items?.properties.key).toEqual({
        type: "string",
        minLength: 1,
        maxLength: 64,
        pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
      });
    }
  });

  it("accepts valid and null R3 entity keys and every valid R3 relation key", () => {
    expect(parseRelatedPetAnnotationProposal(
      r3Proposal,
      RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
    )).toMatchObject({
      entity: { key: "vi" },
      franchises: [{ key: "arcane" }],
      franchiseFamilies: [{ key: "league-of-legends" }],
      collections: [{ key: "piltover-champions" }],
      specificArchetypes: [{ key: "punk-fighter" }],
      themes: [{ key: "rebellious-hero" }],
      mediaOrigins: [{ key: "animated-series" }],
    });
    expect(parseRelatedPetAnnotationProposal({
      ...r3Proposal,
      entity: { key: null, aliases: [], confidence: "none", evidence: [] },
    }, RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3).entity.key).toBeNull();
    const key64 = "a".repeat(64);
    expect(parseRelatedPetAnnotationProposal({
      ...r3Proposal,
      themes: [relation(key64)],
    }, RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3).themes[0]?.key).toBe(key64);
  });

  it.each([
    ["entity", "entity.key", "Vi"],
    ["franchises", "franchises[0].key", "кот"],
    ["franchise_families", "franchise_families[0].key", "league.of.legends"],
    ["collections", "collections[0].key", " codex"],
    ["specific_archetypes", "specific_archetypes[0].key", "punk--fighter"],
    ["themes", "themes[0].key", "rebellious hero"],
    ["media_origins", "media_origins[0].key", "a".repeat(65)],
  ] as const)("rejects an invalid R3 %s identifier without repairing it", (field, path, key) => {
    const candidate = field === "entity"
      ? { ...r3Proposal, entity: { ...r3Proposal.entity, key } }
      : { ...r3Proposal, [field]: [relation(key)] };

    expect(() => parseRelatedPetAnnotationProposal(
      candidate,
      RELATED_PETS_ANNOTATION_PROPOSAL_REVISION_R3,
    )).toThrow(expect.objectContaining({
      issues: [expect.objectContaining({ path, code: "invalid_identifier" })],
    }));
  });

  it("retains legacy normalization for R2 wire and stored proposals", () => {
    expect(parseRelatedPetAnnotationProposal({
      ...rawProposal,
      themes: [relation(" Rebellious  Hero ")],
    }).themes[0]?.key).toBe("rebellious-hero");
    expect(parseStoredRelatedPetAnnotationProposal({
      entity: { key: "Vi", aliases: [], confidence: "high", evidence: ["name"] },
      franchises: [],
      franchiseFamilies: [],
      collections: [],
      specificArchetypes: [],
      themes: [{ key: "Rebellious Hero", confidence: "medium", evidence: ["description"] }],
      mediaOrigins: [],
    }).themes[0]?.key).toBe("rebellious-hero");
  });

  it("rejects unknown revisions before hashing", () => {
    expect(() => getRelatedPetAnnotationProposalContract("unknown"))
      .toThrow("annotation_proposal_revision_unsupported");
    expect(() => createRelatedPetAnnotationProposalInputHash({
      pet,
      modelUri: "gpt://fixture/qwen3.6-35b-a3b",
      proposalRevision: "unknown",
    })).toThrow("annotation_proposal_revision_unsupported");
  });
});

function relation(key: string) {
  return { key, confidence: "medium" as const, evidence: ["description" as const] };
}
