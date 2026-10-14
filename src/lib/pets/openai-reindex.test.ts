import { describe, expect, it, vi } from "vitest";
import { applyOpenAIIndex, describeOpenAIIndexInputs } from "@/lib/pets/openai-reindex";
import { embeddingToBuffer } from "@/lib/pets/search-embeddings";
import { OPENAI_PETS_REVISIONS } from "@/lib/pets/openai-embedding-profile";
import type { StoredRawPetSearchEmbedding } from "@/lib/pets/search-embeddings-repository";
const store = vi.hoisted(() => ({ rows: new Map<string, StoredRawPetSearchEmbedding>(), loseAck: false }));
vi.mock("@/lib/pets/search-embeddings-repository", () => ({
  listRawPetSearchEmbeddings: async (revision: string) => [...store.rows.values()].filter((r) => r.modelRevision === revision),
  upsertPetSearchEmbedding: async (row: Omit<StoredRawPetSearchEmbedding, "embedding"> & { embedding: number[] }) => {
    store.rows.set(`${row.modelRevision}/${row.slug}`, { ...row, embedding: embeddingToBuffer(row.embedding) });
    if (store.loseAck) { store.loseAck = false; throw new Error("YDB commit acknowledgement lost"); }
  },
}));
describe("additive six-channel reindex", () => {
  it("resumes partial YDB commits from saved provider results without overwriting the legacy revision", async () => {
    store.rows.clear();
    const embedding: number[] = [1, ...Array(3071).fill(0)];
    const legacy = { slug: "cat", modelRevision: "legacy", sourceHash: "old", dimensions: 768,
      embedding: embeddingToBuffer(Array(768).fill(0.1)), updatedAt: "old" };
    store.rows.set("legacy/cat", legacy);
    const rows = Object.values(OPENAI_PETS_REVISIONS).map((modelRevision) => ({ slug: "cat", modelRevision, sourceHash: modelRevision, text: "one canonical text" }));
    const cache = new Map<string, number[]>(); const paid = vi.fn();
    const embed = async (texts: string[]) => texts.map((text) => {
      if (!cache.has(text)) { paid(text); cache.set(text, embedding); } return cache.get(text)!;
    });
    store.loseAck = true;
    await expect(applyOpenAIIndex(rows, embed, vi.fn())).rejects.toThrow("acknowledgement");
    expect(await applyOpenAIIndex(rows, embed, vi.fn())).toEqual({ written: 5, reused: 1 });
    expect(paid).toHaveBeenCalledTimes(1); expect(store.rows.get("legacy/cat")).toBe(legacy);
    expect(await applyOpenAIIndex(rows, embed, vi.fn())).toEqual({ written: 0, reused: 6 });
    const summary = describeOpenAIIndexInputs(rows);
    expect(summary).toMatchObject({ pets: 1, vectors: 6, uniqueInputs: 1 });
    expect(JSON.stringify(summary)).not.toContain("canonical text");
  });
});
