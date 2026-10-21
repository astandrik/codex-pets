import {mkdtemp, writeFile, readFile, rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import {afterEach, expect, it, vi} from "vitest";
import {spriteRenderer} from "./sprite-renderer";
import {jobSchema} from "./model";
vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {...actual, mkdtemp: vi.fn(actual.mkdtemp)};
});
afterEach(() => {vi.unstubAllEnvs(); vi.clearAllMocks();});
it("writes accepted animation guidance to the real private renderer job without a provider call", async () => {
  const folder = await mkdtemp(path.join(tmpdir(), "animation-hint-key-"));
  await writeFile(path.join(folder, "key"), "synthetic-provider-key", {mode: 0o600});
  vi.stubEnv("PET_GENERATION_OPENAI_KEY_FILE", path.join(folder, "key")); vi.stubEnv("PET_GENERATION_PROXY_URL", "http://172.17.0.1:18090");
  const hint = "Во время прыжка поджимает лапы";
  const job = jobSchema.parse({id: "a".repeat(64), prompt: "fox", displayName: "Fox", status: "generating", createdAt: 0, expiresAt: Date.now() + 86400000, worker: "test", promptRevision: "test", reviewBase: true, baseConfirmedAt: 1, animationPrompt: hint});
  const session = await spriteRenderer.open(job, new Map([["base", Buffer.from("base")]]));
  try {
    const workspace = await vi.mocked(mkdtemp).mock.results.at(-1)!.value;
    const payload = JSON.parse(await readFile(path.join(workspace, "job.json"), "utf8"));
    expect(payload.animationPrompt).toBe(hint); expect(payload.rows).toHaveLength(11);
    expect(await readFile(path.join(workspace, "base.png"), "utf8")).toBe("base");
  } finally {await session.cleanup(); await rm(folder, {recursive: true});}
});
