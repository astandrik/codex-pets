import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddingServer } from "@/lib/pets/embedding-worker/server";
import { EmbeddingLedger } from "@/lib/pets/embedding-worker/ledger";
import { OPENAI_EMBEDDING_MODEL } from "@/lib/pets/openai-embedding-profile";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function setup(allowOnline = false) {
  const directory = mkdtempSync(join(tmpdir(), "pets-embedding-http-"));
  const request = vi.fn(async (texts: readonly string[]) => ({ model: OPENAI_EMBEDDING_MODEL,
    data: texts.map((_text, index) => ({ index, embedding: [1, ...Array(3071).fill(0)] })),
    usage: { prompt_tokens: texts.length, total_tokens: texts.length } }));
  const server = createEmbeddingServer({ token: "private-token", ledger: new EmbeddingLedger(directory, 1, request), request, allowOnline });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("listener_missing");
  cleanups.push(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); rmSync(directory, { recursive: true }); });
  return { request, url: `http://127.0.0.1:${address.port}`, auth: { Authorization: "Bearer private-token", "Content-Type": "application/json" } };
}
describe("private embedding HTTP boundary", () => {
  it("requires auth, rejects arbitrary URLs and model input, and keeps online closed", async () => {
    const { url, auth, request } = await setup();
    expect((await fetch(`${url}/health`)).status).toBe(401);
    expect((await fetch(`${url}/health`, { headers: auth })).status).toBe(200);
    expect((await fetch(`${url}/v1/models`, { headers: auth })).status).toBe(404);
    const send = (body: unknown) => fetch(`${url}/embeddings`, { method: "POST", headers: auth, body: JSON.stringify(body) });
    expect((await send({ input: ["cat"], mode: "migration", model: "other" })).status).toBe(400);
    expect((await send({ input: ["cat"], mode: "online" })).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
    expect((await send({ input: ["cat"], mode: "migration" })).status).toBe(200);
    expect((await send({ input: ["cat"], mode: "migration" })).status).toBe(200);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(["{", ""])("classifies malformed JSON %j as invalid input", async (body) => {
    const { url, auth, request } = await setup();
    const response = await fetch(`${url}/embeddings`, { method: "POST", headers: auth, body });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_request" });
    expect(request).not.toHaveBeenCalled();
  });
  it("coalesces live online calls without exposing provider failure content", async () => {
    const { url, auth, request } = await setup(true);
    request.mockRejectedValue(new Error("secret input must never be returned"));
    const send = () => fetch(`${url}/embeddings`, { method: "POST", headers: auth, body: JSON.stringify({ input: ["cat"], mode: "online" }) });
    const responses = await Promise.all([send(), send()]);
    for (const response of responses) { expect(response.status).toBe(503); expect(await response.text()).toBe('{"error":"embedding_unavailable"}'); }
    expect(request).toHaveBeenCalledTimes(1);
  });
});
