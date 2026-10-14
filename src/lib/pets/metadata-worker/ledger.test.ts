import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MetadataLedger, metadataHash, metadataReserveUSD, parseMetadataResponse, type MetadataRequest } from "@/lib/pets/metadata-worker/ledger";
import { OPENAI_METADATA_MODEL } from "@/lib/pets/metadata-sources";

const syncFailure = vi.hoisted(() => ({ calls: 0, failOn: 0 }));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, fsyncSync(fd: number) {
    actual.fsyncSync(fd); syncFailure.calls++;
    if (syncFailure.calls === syncFailure.failOn) throw new Error("save_ack_lost");
  } };
});
const directories: string[] = [];
function directory() { const result = mkdtempSync(join(tmpdir(), "pets-metadata-")); directories.push(result); return result; }
const context = metadataHash({ pet: "synthetic" });
const annotation: MetadataRequest = { stage: "annotation", body: { prompt: "synthetic private text" },
  inputTokenBound: 2000, reservedUSD: metadataReserveUSD(2000) };
const caption: MetadataRequest = { stage: "caption", body: { image: "synthetic-private-image" },
  inputTokenBound: 3000, reservedUSD: metadataReserveUSD(3000) };
function response(value: unknown = { valid: true }) {
  return { id: "resp_synthetic", model: OPENAI_METADATA_MODEL, status: "completed", service_tier: "default",
    output: [{ type: "reasoning", summary: [] }, { type: "message", role: "assistant", status: "completed",
      content: [{ type: "output_text", text: JSON.stringify(value) }] }],
    usage: { input_tokens: 120, output_tokens: 50, total_tokens: 170 } };
}
function validate(value: unknown) {
  if (JSON.stringify(value) !== '{"valid":true}') throw new Error("bad_schema");
  return { valid: true };
}
afterEach(() => { directories.splice(0).forEach((path) => rmSync(path, { recursive: true })); syncFailure.calls = 0; syncFailure.failOn = 0; });

describe("finite metadata receipts", () => {
  it("persists intent before provider and raw response before consumer; restarts do not repay stages", async () => {
    const path = directory();
    const provider = vi.fn(async () => {
      expect(JSON.parse(readFileSync(join(path, "metadata-ledger.json"), "utf8")).receipts.at(-1).state).toBe("intent");
      return response();
    });
    const ledger = new MetadataLedger(path, context, provider);
    await ledger.generate(annotation, (value) => {
      expect(JSON.parse(readFileSync(join(path, "metadata-ledger.json"), "utf8")).receipts[0].state).toBe("responded");
      return validate(value);
    });
    await new MetadataLedger(path, context, provider).generate(annotation, validate);
    await new MetadataLedger(path, context, provider).generate(caption, validate);
    expect(provider).toHaveBeenCalledTimes(2);
    expect(readFileSync(join(path, "metadata-ledger.json"), "utf8")).not.toContain("synthetic private text");
    expect(ledger.summary.usage).toHaveLength(2);
  });
  it("unknown timeout blocks both restart and a different next stage without releasing reserve", async () => {
    const path = directory(); const provider = vi.fn(async () => { throw new Error("timeout"); });
    await expect(new MetadataLedger(path, context, provider).generate(annotation, validate)).rejects.toThrow("timeout");
    const restarted = new MetadataLedger(path, context, provider);
    await expect(restarted.generate(annotation, validate)).rejects.toThrow("outcome_unknown");
    await expect(restarted.generate(caption, validate)).rejects.toThrow("outcome_unknown");
    expect(provider).toHaveBeenCalledTimes(1); expect(restarted.summary.committedUSD).toBe(annotation.reservedUSD);
  });
  it("reconciles a lost local save ACK from the already committed response", async () => {
    const path = directory(); const provider = vi.fn(async () => response());
    syncFailure.failOn = 4; // Response rename and directory fsync completed, then acknowledgement failed.
    expect(await new MetadataLedger(path, context, provider).generate(annotation, validate)).toEqual({ valid: true });
    expect(await new MetadataLedger(path, context, provider).generate(annotation, validate)).toEqual({ valid: true });
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("blocks after a response failed to commit, even when the original process had received it", async () => {
    const path = directory(); const provider = vi.fn(async () => response());
    syncFailure.failOn = 3; // Temp response is fsynced, but not renamed over durable intent.
    await expect(new MetadataLedger(path, context, provider).generate(annotation, validate)).rejects.toThrow("save_unknown");
    await expect(new MetadataLedger(path, context, provider).generate(annotation, validate)).rejects.toThrow("outcome_unknown");
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it("two instances observe the first durable intent and do not both call the provider", async () => {
    const path = directory(); let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const provider = vi.fn(async () => { await pending; return response(); });
    const first = new MetadataLedger(path, context, provider); const second = new MetadataLedger(path, context, provider);
    const running = first.generate(annotation, validate);
    await expect(second.generate(annotation, validate)).rejects.toThrow("outcome_unknown");
    finish(); await running; expect(provider).toHaveBeenCalledTimes(1);
  });
  it("rejects changed content, schema failures and old receipt formats without retry", async () => {
    const path = directory(); const provider = vi.fn(async () => response({ wrong: true }));
    const ledger = new MetadataLedger(path, context, provider);
    await expect(ledger.generate(annotation, validate)).rejects.toThrow("schema_invalid");
    await expect(ledger.generate(annotation, validate)).rejects.toThrow("schema_invalid");
    await expect(ledger.generate({ ...annotation, body: { changed: true } }, validate)).rejects.toThrow("request_conflict");
    expect(provider).toHaveBeenCalledTimes(1);
    writeFileSync(join(path, "metadata-ledger.json"), JSON.stringify({ schemaVersion: 0, receipts: [] }));
    expect(() => new MetadataLedger(path, context, provider)).toThrow("ledger_invalid_or_stale");
  });
  it("refuses an over-budget reservation before a call and never starts caption first", async () => {
    const provider = vi.fn(async () => response()); const ledger = new MetadataLedger(directory(), context, provider);
    await expect(ledger.generate({ ...annotation, inputTokenBound: 200_000, reservedUSD: metadataReserveUSD(200_000) }, validate)).rejects.toThrow("budget_exhausted");
    await expect(ledger.generate(caption, validate)).rejects.toThrow("stage_order_invalid");
    expect(provider).not.toHaveBeenCalled();
  });
  it("rejects changed context and tampered saved response hashes", async () => {
    const path = directory(); const provider = vi.fn(async () => response());
    await new MetadataLedger(path, context, provider).generate(annotation, validate);
    expect(() => new MetadataLedger(path, metadataHash("different source"), provider)).toThrow("stale");
    const file = join(path, "metadata-ledger.json"); const stored = JSON.parse(readFileSync(file, "utf8"));
    stored.receipts[0].response.id = "tampered"; writeFileSync(file, JSON.stringify(stored));
    expect(() => new MetadataLedger(path, context, provider)).toThrow("hash_mismatch");
  });
  it("rejects unsupported provider responses and tool/refusal output", () => {
    for (const invalid of [{ ...response(), model: "other" }, { ...response(), status: "incomplete" },
      { ...response(), service_tier: "ultrafast" }, { ...response(), output: [{ type: "function_call" }] },
      { ...response(), usage: { input_tokens: 1, output_tokens: 9000, total_tokens: 9001 } }]) {
      expect(() => parseMetadataResponse(invalid)).toThrow();
    }
  });
});
