import { describe, expect, it, vi } from "vitest";
import {
  getAdditionalMetadataInputRevisions, normalizeEmbeddingModelRevisions, serializeRankingInputRevision,
  type CatalogInputRevision, type EmbeddingInputRevision, type MetadataInputRevision,
} from "@/lib/pets/metadata-input-revisions";
import { createRelatedPetsRepository, type RelatedPetsRankingInputScope } from "@/lib/pets/related/related-pets-repository";
import { createApprovalPreparationsRepository } from "@/lib/pets/approval-preparations-repository";
import { OPENAI_ANNOTATION_REVISION, OPENAI_CAPTION_REVISION } from "@/lib/pets/metadata-sources";
const values = { utf8: (value: string) => value };
const result = (hash: string) => ({ resultSets: [{ rows: [{ items: [{ textValue: "lumi" }, { textValue: hash }, { textValue: "now" }] }] }] });

describe("mixed-source transaction fingerprints", () => {
  it("leaves the old input fingerprint contract untouched when extra sources are absent", async () => {
    const execute = vi.fn();
    expect(await getAdditionalMetadataInputRevisions(execute, values, {})).toEqual({});
    expect(execute).not.toHaveBeenCalled();
  });
  it("includes both actual revision and row hashes, with stable order and deduplication", async () => {
    const execute = vi.fn(async () => result("before"));
    const scope = { additionalAnnotationRevisions: [OPENAI_ANNOTATION_REVISION, OPENAI_ANNOTATION_REVISION], additionalCaptionRevisions: [OPENAI_CAPTION_REVISION] };
    const before = await getAdditionalMetadataInputRevisions(execute, values, scope);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(before.additionalAnnotations).toEqual([JSON.stringify([OPENAI_ANNOTATION_REVISION, [["lumi", "before", "now"]]])]);
    expect(before.additionalCaptions).toEqual([JSON.stringify([OPENAI_CAPTION_REVISION, [["lumi", "before", "now"]]])]);
    expect(await getAdditionalMetadataInputRevisions(async () => result("changed"), values, scope)).not.toEqual(before);
  });
});


type FingerprintData = {
  catalog: CatalogInputRevision;
  embeddings: EmbeddingInputRevision[number][1];
  captions: MetadataInputRevision[1];
  annotations: MetadataInputRevision[1];
  additionalCaptions: MetadataInputRevision[1];
  additionalAnnotations: MetadataInputRevision[1];
};
function fingerprintData(): FingerprintData {
  return {
    catalog: [["alpha", "catalog-time"]],
    embeddings: [["alpha", "embedding-hash", 256, "embedding-time"]],
    captions: [["alpha", "caption-hash", "caption-time"]],
    annotations: [["alpha", "annotation-hash", "annotation-time"]],
    additionalCaptions: [["alpha", "extra-caption-hash", "extra-caption-time"]],
    additionalAnnotations: [["alpha", "extra-annotation-hash", "extra-annotation-time"]],
  };
}
function fingerprintScope(revisions: readonly string[] = ["embedding-v1"]): RelatedPetsRankingInputScope {
  return { embeddingModelRevisions: revisions, captionRevision: "caption-v1", annotationRevision: "annotation-v1",
    additionalCaptionRevisions: ["extra-caption"], additionalAnnotationRevisions: ["extra-annotation"] };
}
function sdkRows(data: readonly (readonly (string | number | boolean)[])[]) {
  return { resultSets: [{ rows: data.map(row => ({ items: row.map(value =>
    typeof value === "number" ? { uint32Value: value } : typeof value === "boolean" ? { boolValue: value } : { textValue: value }) })) }] };
}
function fingerprintRepositories(data: FingerprintData) {
  let transactional = false;
  const writes: string[] = [];
  const calls: Array<{ statement: string; params: Record<string, unknown>; transactional: boolean }> = [];
  const execute = async (statement: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    calls.push({ statement, params, transactional });
    if (statement.includes("UPSERT INTO codex_pet_reviews")) {
      expect(transactional).toBe(true);
      writes.push(statement);
      return { resultSets: [] };
    }
    if (statement.includes("SELECT COUNT(*) AS pet_count")) {
      return { resultSets: [1, 1, 2].map(count => ({ rows: [{ items: [{ uint32Value: count }] }] })) };
    }
    if (statement.includes("WHERE preparation_id = $preparation_id")) {
      return sdkRows([["approval-1", "pet-pending", "pending-slug", "pet-time", "admin-1", "ranking-v1", "active-generation", "", "preparing", 1, "", "worker-1", "2099-01-01T00:00:00.000Z", "", "created", "updated", false]]);
    }
    if (/FROM\s+codex_pets\b/.test(statement)) return sdkRows(data.catalog);
    if (/FROM\s+codex_pet_search_embeddings\b/.test(statement)) return sdkRows(data.embeddings);
    if (/FROM\s+codex_pet_search_captions\b/.test(statement)) return sdkRows(params.$revision === undefined ? data.captions : data.additionalCaptions);
    if (/FROM\s+codex_pet_related_annotations\b/.test(statement)) return sdkRows(params.$revision === undefined ? data.annotations : data.additionalAnnotations);
    throw new Error("Unexpected synthetic query");
  };
  const typedValues = { utf8: (value: string) => value, json: (value: string) => value, uint32: (value: number) => value, bool: (value: boolean) => value };
  const related = createRelatedPetsRepository({ isConfigured: () => true, values: typedValues, execute,
    transaction: async () => { throw new Error("Fingerprint read must not open a transaction"); } });
  const approval = createApprovalPreparationsRepository({ isConfigured: () => true, values: typedValues,
    execute: async () => { throw new Error("Finalization escaped its transaction"); },
    transaction: async <T>(operation: (actual: typeof execute) => Promise<T>) => {
      transactional = true;
      try { return await operation(execute); } finally { transactional = false; }
    },
  });
  return { related, calls, writes,
    finalize: (scope: RelatedPetsRankingInputScope, expectedInputRevision: string) => approval.finalize({
      preparationId: "approval-1", workerId: "worker-1", preparedGenerationId: "prepared-generation", reviewId: "review-1",
      now: "2026-10-14T12:00:00.000Z", inputScope: scope, expectedInputRevision, expectedSnapshotCount: 2,
    }),
  };
}
async function requiredRevision(harness: ReturnType<typeof fingerprintRepositories>, scope: RelatedPetsRankingInputScope) {
  const revision = await harness.related.getRankingInputRevision(scope);
  if (revision === null) throw new Error("Synthetic repository should be configured");
  return revision;
}

const canonicalGolden = "{\"additionalCaptions\":[\"[\\\"extra-caption\\\",[[\\\"alpha\\\",\\\"extra-caption-hash\\\",\\\"extra-caption-time\\\"]]]\"],\"additionalAnnotations\":[\"[\\\"extra-annotation\\\",[[\\\"alpha\\\",\\\"extra-annotation-hash\\\",\\\"extra-annotation-time\\\"]]]\"],\"catalog\":\"[[\\\"alpha\\\",\\\"catalog-time\\\"]]\",\"embeddings\":\"[[\\\"embedding-v1\\\",[[\\\"alpha\\\",\\\"embedding-hash\\\",256,\\\"embedding-time\\\"]]]]\",\"captions\":\"[\\\"caption-v1\\\",[[\\\"alpha\\\",\\\"caption-hash\\\",\\\"caption-time\\\"]]]\",\"annotations\":\"[\\\"annotation-v1\\\",[[\\\"alpha\\\",\\\"annotation-hash\\\",\\\"annotation-time\\\"]]]\"}";

describe("ranking fingerprint wire contract", () => {
  it("preserves the literal empty wire format and omitted annotation field", () => {
    expect(serializeRankingInputRevision({ catalog: [], embeddings: [], captions: null }))
      .toBe('{"catalog":"[]","embeddings":"[]","captions":null}');
  });

  it("normalizes embedding keys before deduplication without mutating the caller", () => {
    const revisions = Object.freeze([" b ", "a", "b", "", "  ", "a "]);
    expect(normalizeEmbeddingModelRevisions(revisions)).toEqual(["a", "b"]);
    expect(revisions).toEqual([" b ", "a", "b", "", "  ", "a "]);
  });

  it("does not apply embedding-key normalization to additional metadata revisions", async () => {
    const execute = vi.fn<(statement: string, params: Record<string, unknown>) => Promise<ReturnType<typeof result>>>().mockResolvedValue(result("hash"));
    const actual = await getAdditionalMetadataInputRevisions(execute, values, { additionalCaptionRevisions: [" padded-caption "] });
    expect(execute.mock.calls[0][1]).toEqual({ $revision: " padded-caption " });
    expect(actual.additionalCaptions).toEqual([JSON.stringify([" padded-caption ", [["lumi", "hash", "now"]]])]);
  });

  it("retains literal canonical bytes including the nested JSON and additional field order", async () => {
    const data = fingerprintData();
    expect(serializeRankingInputRevision({
      additionalAnnotations: [JSON.stringify(["extra-annotation", data.additionalAnnotations])],
      additionalCaptions: [JSON.stringify(["extra-caption", data.additionalCaptions])],
      catalog: data.catalog, embeddings: [["embedding-v1", data.embeddings]],
      captions: ["caption-v1", data.captions], annotations: ["annotation-v1", data.annotations],
    })).toBe(canonicalGolden);
    expect(await requiredRevision(fingerprintRepositories(data), fingerprintScope())).toBe(canonicalGolden);
  });
});

describe("approval and rebuild fingerprint agreement", () => {
  it.each([
    { revisions: ["embedding-v1"] }, { revisions: ["embedding-v1", " embedding-v1 "] },
    { revisions: [" embedding-v1 ", "embedding-v1", "embedding-v1"] }, { revisions: [] },
  ])("finalizes with the actual related fingerprint for $revisions", async ({ revisions }) => {
    const harness = fingerprintRepositories(fingerprintData()), scope = fingerprintScope(revisions);
    const revision = await requiredRevision(harness, scope);
    const readCount = harness.calls.length;
    await expect(harness.finalize(scope, revision)).resolves.toBe("succeeded");
    expect(harness.writes).toHaveLength(1);
    expect(harness.calls.slice(readCount).every(call => call.transactional)).toBe(true);
    expect(harness.calls.filter(call => call.transactional && call.params.$model_revision !== undefined))
      .toHaveLength(revisions.length ? 1 : 0);
  });

  it.each(["catalog", "embeddings", "captions", "annotations", "additionalCaptions", "additionalAnnotations"] as const)("blocks final publication when %s changes", async (group) => {
    const data = fingerprintData(), harness = fingerprintRepositories(data), scope = fingerprintScope();
    const revision = await requiredRevision(harness, scope);
    data[group][0][1] = "changed";
    await expect(harness.finalize(scope, revision)).resolves.toBe("ranking_inputs_changed");
    expect(harness.writes).toHaveLength(0);
  });

  it.each([
    ["catalog", "Invalid related pets catalog revision row."],
    ["embeddings", "Invalid related pets embedding revision row."],
    ["captions", "Invalid related pets caption revision row."],
    ["annotations", "Invalid related pets annotation revision row."],
  ] as const)("preserves distinct malformed primary %s outcomes", async (group, message) => {
    const data = fingerprintData(), harness = fingerprintRepositories(data), scope = fingerprintScope();
    const revision = await requiredRevision(harness, scope);
    if (group === "embeddings") data.embeddings[0][2] = 0;
    else data[group][0][0] = "";
    await expect(harness.related.getRankingInputRevision(scope)).rejects.toThrow(message);
    await expect(harness.finalize(scope, revision)).resolves.toBe("ranking_inputs_changed");
    expect(harness.writes).toHaveLength(0);
  });

  it.each(["additionalCaptions", "additionalAnnotations"] as const)("retains strict handling of malformed %s", async (group) => {
    const data = fingerprintData(), harness = fingerprintRepositories(data), scope = fingerprintScope();
    const revision = await requiredRevision(harness, scope);
    data[group][0][1] = "";
    await expect(harness.related.getRankingInputRevision(scope)).rejects.toThrow("metadata_revision_row_invalid");
    await expect(harness.finalize(scope, revision)).rejects.toThrow("metadata_revision_row_invalid");
    expect(harness.writes).toHaveLength(0);
  });
});
