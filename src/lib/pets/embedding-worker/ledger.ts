import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { OPENAI_EMBEDDING_DIMENSIONS, OPENAI_EMBEDDING_MODEL } from "@/lib/pets/openai-embedding-profile";

const PRICE_PER_TOKEN = 0.13 / 1_000_000;
const vector = z.array(z.number().finite()).length(OPENAI_EMBEDDING_DIMENSIONS)
  .refine((values) => values.some((v) => Math.abs(v) > 1e-10));
const providerResponse = z.object({ model: z.literal(OPENAI_EMBEDDING_MODEL),
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: vector })).max(32),
  usage: z.object({ prompt_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }),
});
const receiptSchema = z.object({ id: z.string().uuid(), hashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)),
  state: z.enum(["intent", "completed"]), reservedUSD: z.number().nonnegative(),
  createdAt: z.string(), failureCode: z.string().optional(), response: providerResponse.optional(), actualUSD: z.number().nonnegative().optional() });
type Receipt = z.infer<typeof receiptSchema>;

export class EmbeddingLedger {
  private receipts: Receipt[] = [];
  private cache = new Map<string, number[]>();
  private pending = new Map<string, Promise<void>>();
  constructor(private directory: string, private budgetUSD: number,
    private request: (texts: readonly string[]) => Promise<unknown>) {
    if (!Number.isFinite(budgetUSD) || budgetUSD <= 0) throw new Error("embedding_budget_invalid");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(directory).filter((file) => /^[a-f0-9-]+\.json$/.test(file)).sort()) {
      const receipt = receiptSchema.parse(JSON.parse(readFileSync(join(directory, file), "utf8")));
      this.receipts.push(receipt);
      if (receipt.state === "completed") this.restore(receipt);
    }
  }
  get summary() {
    return { requests: this.receipts.length,
      completed: this.receipts.filter((r) => r.state === "completed").length,
      unresolved: this.receipts.filter((r) => r.state === "intent").length,
      tokens: this.receipts.reduce((n, r) => n + (r.response?.usage.prompt_tokens ?? 0), 0),
      actualUSD: this.receipts.reduce((n, r) => n + (r.actualUSD ?? 0), 0),
      committedUSD: this.receipts.reduce((n, r) => n + (r.actualUSD ?? r.reservedUSD), 0),
      cachedInputs: this.cache.size };
  }
  async embed(input: readonly string[]): Promise<{ model: string; data: Array<{ index: number; embedding: number[] }> }> {
    if (input.length < 1 || input.length > 32 || input.some((text) => !text.trim() || Buffer.byteLength(text) > 16_000)) {
      throw new Error("embedding_input_invalid");
    }
    const hashes = input.map(hash);
    const inFlight = new Set(hashes.flatMap((key) => this.receipts
      .filter((r) => r.state === "intent" && r.hashes.includes(key))
      .map((r) => this.pending.get(r.id)).filter((p) => p !== undefined)));
    if (inFlight.size) {
      await Promise.all(inFlight);
      return this.embed(input);
    }
    const missing = new Map<string, string>();
    input.forEach((text, index) => { if (!this.cache.has(hashes[index])) missing.set(hashes[index], text); });
    if (missing.size) {
      // Known saved vectors remain readable, but no new charge follows an unknown outcome.
      if (this.receipts.some((r) => r.state === "intent" && !this.pending.has(r.id))) {
        throw new Error("embedding_outcome_unknown");
      }
      if (this.pending.size >= 2) throw new Error("embedding_overloaded");
      const reserve = [...missing.values()].reduce((n, text) => n + Buffer.byteLength(text), 0) * PRICE_PER_TOKEN;
      if (this.summary.committedUSD + reserve > this.budgetUSD) throw new Error("embedding_budget_exhausted");
      const receipt: Receipt = { id: randomUUID(), state: "intent", hashes: [...missing.keys()],
        reservedUSD: reserve, createdAt: new Date().toISOString() };
      this.save(receipt); // Durable intent precedes the external charge.
      this.receipts.push(receipt);
      const operation = Promise.resolve().then(async () => {
        const response = providerResponse.parse(await this.request([...missing.values()]));
        if (response.data.length !== missing.size || new Set(response.data.map((r) => r.index)).size !== missing.size ||
            response.data.some((r) => r.index >= missing.size)) throw new Error("embedding_response_invalid");
        const completed: Receipt = { ...receipt, state: "completed", response,
          actualUSD: response.usage.prompt_tokens * PRICE_PER_TOKEN };
        this.save(completed); // Paid response persisted before downstream YDB writes.
        this.receipts[this.receipts.indexOf(receipt)] = completed;
        this.restore(completed);
      });
      this.pending.set(receipt.id, operation);
      try { await operation; } catch (error) {
        const code = error instanceof Error && /^embedding_[a-z0-9_]+$/.test(error.message)
          ? error.message : "embedding_response_invalid";
        const persisted = receiptSchema.parse(JSON.parse(readFileSync(join(this.directory, `${receipt.id}.json`), "utf8")));
        if (persisted.state === "completed") {
          // Resolve a lost local commit acknowledgement by reading and syncing the saved response.
          this.save(persisted);
          this.receipts[this.receipts.indexOf(receipt)] = persisted;
          this.restore(persisted);
        } else {
          receipt.failureCode = code;
          this.save(receipt);
          throw error;
        }
      } finally { this.pending.delete(receipt.id); }
    }
    return { model: OPENAI_EMBEDDING_MODEL, data: hashes.map((key, index) => {
      const embedding = this.cache.get(key);
      if (!embedding) throw new Error("embedding_receipt_missing");
      return { index, embedding: [...embedding] };
    }) };
  }
  private restore(receipt: Receipt) {
    if (!receipt.response || receipt.response.data.length !== receipt.hashes.length ||
        new Set(receipt.response.data.map((row) => row.index)).size !== receipt.hashes.length) throw new Error("embedding_receipt_invalid");
    for (const row of receipt.response.data) {
      const key = receipt.hashes[row.index];
      if (!key) throw new Error("embedding_receipt_invalid");
      this.cache.set(key, row.embedding);
    }
  }
  private save(receipt: Receipt) {
    const target = join(this.directory, `${receipt.id}.json`);
    const temporary = `${target}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(receipt)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, target);
    const dir = openSync(this.directory, "r");
    try { fsyncSync(dir); } finally { closeSync(dir); }
    if (!existsSync(target)) throw new Error("embedding_receipt_not_committed");
  }
}
function hash(text: string) { return createHash("sha256").update(text).digest("hex"); }
