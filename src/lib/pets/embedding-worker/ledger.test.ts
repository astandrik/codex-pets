import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmbeddingLedger } from "@/lib/pets/embedding-worker/ledger";
import { OPENAI_EMBEDDING_MODEL } from "@/lib/pets/openai-embedding-profile";
const directories: string[] = [];
function directory() { const path = mkdtempSync(join(tmpdir(), "pets-embedding-ledger-")); directories.push(path); return path; }
function response(texts: readonly string[]) { return { model: OPENAI_EMBEDDING_MODEL,
  data: texts.map((_text, index) => ({ index, embedding: Array.from({ length: 3072 }, (_, i): number => i === 0 ? 1 : 0) })),
  usage: { prompt_tokens: texts.length * 2, total_tokens: texts.length * 2 } }; }
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true })));
describe("durable embedding requests", () => {
  it("deduplicates logical channels and resumes after a lost downstream YDB acknowledgement", async () => {
    const path = directory(); const provider = vi.fn(async (texts) => response(texts));
    const first = new EmbeddingLedger(path, 1, provider);
    await first.embed(["public kitten", "public kitten", "dragon"]);
    expect(provider).toHaveBeenCalledTimes(1); expect(provider.mock.calls[0][0]).toEqual(["public kitten", "dragon"]);
    const next = new EmbeddingLedger(path, 1, provider);
    expect((await next.embed(["dragon", "public kitten"])).data).toHaveLength(2);
    expect(provider).toHaveBeenCalledTimes(1); expect(next.summary.unresolved).toBe(0);
    for (const file of readdirSync(path)) expect(readFileSync(join(path, file), "utf8")).not.toContain("public kitten");
  });
  it("persists intent before provider call and blocks unknown outcomes across restart", async () => {
    const path = directory(); const provider = vi.fn(async () => {
      expect(readdirSync(path)).toHaveLength(1);
      expect(JSON.parse(readFileSync(join(path, readdirSync(path)[0]), "utf8")).state).toBe("intent");
      throw new Error("timeout");
    });
    await expect(new EmbeddingLedger(path, 1, provider).embed(["kitten"])).rejects.toThrow("timeout");
    const restarted = new EmbeddingLedger(path, 1, provider);
    await expect(restarted.embed(["different"])).rejects.toThrow("outcome_unknown");
    expect(provider).toHaveBeenCalledTimes(1); expect(restarted.summary.committedUSD).toBeGreaterThan(0);
  });
  it("reserves budget before accepting concurrent requests", async () => {
    const provider = vi.fn(async (texts) => response(texts)); const ledger = new EmbeddingLedger(directory(), 0.00000001, provider);
    await expect(ledger.embed(["over budget"])).rejects.toThrow("budget_exhausted"); expect(provider).not.toHaveBeenCalled();
  });
  it("coalesces overlapping concurrent batches", async () => {
    let finish!: () => void; const wait = new Promise<void>((resolve) => { finish = resolve; });
    const provider = vi.fn(async (texts) => { await wait; return response(texts); });
    const ledger = new EmbeddingLedger(directory(), 1, provider);
    const first = ledger.embed(["cat"]); const second = ledger.embed(["cat"]); finish();
    await Promise.all([first, second]); expect(provider).toHaveBeenCalledTimes(1);
  });
  it("rechecks claims after two waiters resume on an overlapping batch", async () => {
    let finish!: () => void;
    const wait = new Promise<void>((resolve) => { finish = resolve; });
    const provider = vi.fn(async (texts: readonly string[]) => {
      if (texts.includes("cat")) await wait;
      return response(texts);
    });
    const ledger = new EmbeddingLedger(directory(), 1, provider);
    const first = ledger.embed(["cat"]);
    const second = ledger.embed(["cat", "dog"]);
    const third = ledger.embed(["cat", "dog"]);
    finish();
    await Promise.all([first, second, third]);
    expect(provider.mock.calls.map(([texts]) => texts)).toEqual([["cat"], ["dog"]]);
    expect(ledger.summary.requests).toBe(2);
  });
  it.each(["dimensions", "zero", "duplicate", "nan"])("rejects %s vectors without retry", async (defect) => {
    const provider = vi.fn(async () => {
      const result = response(["cat", "dog"]);
      if (defect === "dimensions") result.data[0].embedding.pop();
      if (defect === "zero") result.data[0].embedding.fill(0);
      if (defect === "duplicate") result.data[1].index = 0;
      if (defect === "nan") result.data[0].embedding[0] = NaN;
      return result;
    });
    const ledger = new EmbeddingLedger(directory(), 1, provider);
    await expect(ledger.embed(["cat", "dog"])).rejects.toThrow();
    await expect(ledger.embed(["cat"])).rejects.toThrow("outcome_unknown"); expect(provider).toHaveBeenCalledTimes(1);
  });
});
