import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GenerationError, type GenerationJob } from "./model";
import { spriteRenderer } from "./sprite-renderer";

const execute = vi.hoisted(() => vi.fn());
const readKey = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  return { execFile: Object.assign(vi.fn(), { [promisify.custom]: execute }) };
});
vi.mock("node:fs", async (original) => ({ ...await original<typeof import("node:fs")>(), readFileSync: readKey }));

const cleanups: Array<() => Promise<void>> = [];
const now = Date.now();
const job: GenerationJob = {
  id: "a".repeat(64), prompt: "Synthetic brief", displayName: "Synthetic pet", status: "generating",
  createdAt: now, expiresAt: now + 86_400_000, worker: "synthetic-worker", promptRevision: "test", pipelineVersion: 2, stages: [],
};
beforeEach(() => {
  execute.mockReset().mockResolvedValue({ stdout: "{}", stderr: "" });
  readKey.mockReset().mockReturnValue("synthetic-key");
  vi.stubEnv("PET_GENERATION_OPENAI_KEY_FILE", "/synthetic-key-path");
  vi.stubEnv("PET_GENERATION_PROXY_URL", "http://172.17.0.1:18090");
});
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
  vi.unstubAllEnvs();
});
async function openRenderer() {
  const session = await spriteRenderer.open(job, new Map());
  cleanups.push(() => session.cleanup());
  return session;
}

describe("renderer failure boundaries", () => {
  it.each(["absent", "empty", "ENOENT", "EACCES"])("maps unavailable key configuration without disclosing its path: %s", async (failure) => {
    if (failure === "absent") vi.stubEnv("PET_GENERATION_OPENAI_KEY_FILE", "");
    else if (failure === "empty") readKey.mockReturnValue(" \n");
    else readKey.mockImplementation(() => { throw Object.assign(new Error("synthetic-key-path"), { code: failure, path: "/synthetic-key-path" }); });
    const error = await spriteRenderer.open(job, new Map()).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GenerationError);
    expect(error).toMatchObject({ code: "provider_not_configured" });
    expect(JSON.stringify(error)).not.toContain("synthetic-key-path");
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ["prepare", false], ["prepare", true], ["compose", false], ["compose", true], ["generate", false], ["generate", true],
  ] as const)("maps malformed %s output consistently (process failed: %s)", async (action, failed) => {
    if (failed) execute.mockRejectedValue(Object.assign(new Error("synthetic exec failure"), { stdout: "private invalid stdout", stderr: "private stderr", code: 1 }));
    else execute.mockResolvedValue({ stdout: "private invalid stdout", stderr: "private stderr" });
    const session = await openRenderer();
    const result = action === "generate" ? session.generate("base") : session[action]();
    const error = await result.catch((value: unknown) => value);
    expect(error).toBeInstanceOf(GenerationError);
    expect(error).toMatchObject({ code: action === "generate" ? "outcome_unknown" : "invalid_sprite_extraction", diagnostic: { boundary: "renderer_reply", reason: "invalid_json" } });
    expect(JSON.stringify(error)).not.toMatch(/private|synthetic exec/);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("accepts a valid successful local prepare reply", async () => {
    const session = await openRenderer();
    await expect(session.prepare()).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("retains structured paid-provider rejection without retries (process failed: %s)", async (failed) => {
    const output = { stdout: JSON.stringify({ error: "provider_rejected" }), stderr: "" };
    if (failed) execute.mockRejectedValue(Object.assign(new Error("synthetic process failure"), output));
    else execute.mockResolvedValue(output);
    const session = await openRenderer();
    await expect(session.generate("base")).rejects.toMatchObject({ code: "provider_rejected" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
