import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { OPENAI_METADATA_MODEL } from "@/lib/pets/metadata-sources";

export const METADATA_BUDGET_USD = 0.50;
export const METADATA_MAX_OUTPUT_TOKENS = 4096;
export const METADATA_MAX_CALLS = 2;
const INPUT_PRICE_BOUND = 2.50 / 1_000_000;
const OUTPUT_PRICE = 10 / 1_000_000;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const usageSchema = z.object({ input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(), total_tokens: z.number().int().nonnegative() }).passthrough();
const responseSchema = z.object({ id: z.string().min(1).max(256), model: z.literal(OPENAI_METADATA_MODEL),
  status: z.literal("completed"), output: z.array(z.unknown()).max(16), usage: usageSchema,
  service_tier: z.literal("default").optional() }).passthrough();
const receiptSchema = z.object({ stage: z.enum(["annotation", "caption"]), requestHash: hashSchema,
  state: z.enum(["intent", "responded"]), reservedUSD: z.number().positive(), createdAt: z.string(),
  response: z.unknown().optional(), responseHash: hashSchema.optional() }).strict();
const ledgerSchema = z.object({ schemaVersion: z.literal(1), contextHash: hashSchema,
  receipts: z.array(receiptSchema).max(METADATA_MAX_CALLS) }).strict();
type LedgerData = z.infer<typeof ledgerSchema>;
export type MetadataStage = "annotation" | "caption";
export type MetadataRequest = { stage: MetadataStage; body: unknown; inputTokenBound: number; reservedUSD: number };

export function metadataHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function metadataReserveUSD(inputTokenBound: number): number {
  if (!Number.isSafeInteger(inputTokenBound) || inputTokenBound <= 0 || inputTokenBound >= 272_000) {
    throw new Error("metadata_input_budget_invalid");
  }
  return inputTokenBound * INPUT_PRICE_BOUND + METADATA_MAX_OUTPUT_TOKENS * OUTPUT_PRICE;
}

export function parseMetadataResponse(value: unknown) {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new Error("metadata_response_invalid");
  const response = parsed.data;
  if (response.usage.output_tokens > METADATA_MAX_OUTPUT_TOKENS ||
      response.usage.total_tokens !== response.usage.input_tokens + response.usage.output_tokens) {
    throw new Error("metadata_usage_invalid");
  }
  const texts: string[] = [];
  for (const item of response.output) {
    const message = z.object({ type: z.literal("message"), role: z.literal("assistant"),
      status: z.literal("completed"), content: z.array(z.object({ type: z.literal("output_text"), text: z.string().max(100_000) }).passthrough()).min(1) }).passthrough().safeParse(item);
    if (message.success) { texts.push(...message.data.content.map((part) => part.text)); continue; }
    if (!z.object({ type: z.literal("reasoning") }).passthrough().safeParse(item).success) {
      throw new Error("metadata_response_content_invalid");
    }
  }
  if (texts.length !== 1) throw new Error("metadata_response_content_invalid");
  let valueJSON: unknown;
  try { valueJSON = JSON.parse(texts[0]); } catch { throw new Error("metadata_response_json_invalid"); }
  return { value: valueJSON, responseId: response.id, usage: response.usage,
    estimatedCostBoundUSD: response.usage.input_tokens * INPUT_PRICE_BOUND + response.usage.output_tokens * OUTPUT_PRICE };
}

// One CLI owns the OS flock for its entire lifetime. Each transition also reloads durable state,
// so another in-process instance cannot use a stale empty ledger to repeat a paid stage.
export class MetadataLedger {
  private readonly file: string;
  private busy = false;
  constructor(private directory: string, private contextHash: string,
    private request: (body: unknown) => Promise<unknown>) {
    hashSchema.parse(contextHash);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.file = join(directory, "metadata-ledger.json");
    this.read();
  }
  get summary() {
    const data = this.read();
    return { calls: data.receipts.length, responded: data.receipts.filter((r) => r.state === "responded").length,
      unresolved: data.receipts.filter((r) => r.state === "intent").length,
      committedUSD: data.receipts.reduce((sum, receipt) => sum + this.cost(receipt), 0),
      usage: data.receipts.flatMap((receipt) => {
        try {
          const response = parseMetadataResponse(receipt.response);
          return [{ stage: receipt.stage, responseId: response.responseId, responseHash: receipt.responseHash,
            inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens,
            estimatedCostBoundUSD: response.estimatedCostBoundUSD }];
        } catch { return []; }
      }) };
  }
  readCompleted<T>(input: MetadataRequest, validate: (value: unknown) => T): T {
    const receipt = this.read().receipts.find((row) => row.stage === input.stage);
    if (!receipt || receipt.requestHash !== metadataHash(input.body)) throw new Error("metadata_receipt_missing_or_stale");
    return this.validated(receipt, input, validate);
  }
  async generate<T>(input: MetadataRequest, validate: (value: unknown) => T): Promise<T> {
    if (this.busy) throw new Error("metadata_worker_busy");
    this.busy = true;
    try {
      const data = this.read();
      const found = data.receipts.find((row) => row.stage === input.stage);
      if (found) {
        if (found.requestHash !== metadataHash(input.body)) throw new Error("metadata_request_conflict");
        return this.validated(found, input, validate);
      }
      if (data.receipts.some((row) => row.state === "intent")) throw new Error("metadata_outcome_unknown");
      if (data.receipts.length >= METADATA_MAX_CALLS) throw new Error("metadata_call_limit");
      if (input.stage === "caption" && !data.receipts.some((row) => row.stage === "annotation")) {
        throw new Error("metadata_stage_order_invalid");
      }
      const reserve = metadataReserveUSD(input.inputTokenBound);
      if (reserve !== input.reservedUSD || this.summary.committedUSD + reserve > METADATA_BUDGET_USD) {
        throw new Error("metadata_budget_exhausted");
      }
      const receipt: z.infer<typeof receiptSchema> = { stage: input.stage, requestHash: metadataHash(input.body),
        state: "intent", reservedUSD: reserve, createdAt: new Date().toISOString() };
      data.receipts.push(receipt);
      this.save(data); // fsync intent and directory before sending a chargeable request.
      const response = await this.request(input.body);
      receipt.state = "responded"; receipt.response = response; receipt.responseHash = metadataHash(response);
      try { this.save(data); } catch {
        // A save may have committed before its ACK failed. Read and sync the exact response; never resend.
        const persisted = this.read().receipts.find((row) => row.stage === input.stage);
        if (persisted?.state !== "responded" || persisted.responseHash !== receipt.responseHash) {
          throw new Error("metadata_response_save_unknown");
        }
        this.save(this.read());
      }
      return this.validated(receipt, input, validate);
    } finally { this.busy = false; }
  }
  private validated<T>(receipt: z.infer<typeof receiptSchema>, input: MetadataRequest, validate: (value: unknown) => T): T {
    if (receipt.state !== "responded") throw new Error("metadata_outcome_unknown");
    const response = parseMetadataResponse(receipt.response);
    if (response.usage.input_tokens > input.inputTokenBound || response.estimatedCostBoundUSD > receipt.reservedUSD) {
      throw new Error("metadata_usage_exceeds_reserve");
    }
    try { return validate(response.value); } catch { throw new Error("metadata_schema_invalid"); }
  }
  private cost(receipt: z.infer<typeof receiptSchema>): number {
    try { return parseMetadataResponse(receipt.response).estimatedCostBoundUSD; }
    catch { return receipt.reservedUSD; }
  }
  private read(): LedgerData {
    if (!existsSync(this.file)) return { schemaVersion: 1, contextHash: this.contextHash, receipts: [] };
    const parsed = ledgerSchema.safeParse(JSON.parse(readFileSync(this.file, "utf8")));
    if (!parsed.success || parsed.data.contextHash !== this.contextHash ||
        new Set(parsed.data.receipts.map((row) => row.stage)).size !== parsed.data.receipts.length) {
      throw new Error("metadata_ledger_invalid_or_stale");
    }
    for (const receipt of parsed.data.receipts) {
      if (receipt.state === "responded" && (receipt.response === undefined || receipt.responseHash !== metadataHash(receipt.response))) {
        throw new Error("metadata_receipt_hash_mismatch");
      }
    }
    return parsed.data;
  }
  private save(data: LedgerData): void {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    const fd = openSync(temporary, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify(data)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, this.file);
    const dir = openSync(this.directory, "r");
    try { fsyncSync(dir); } finally { closeSync(dir); }
  }
}
