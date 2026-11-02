import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGenerationService } from "@/lib/pets/generation/service";
import { createGenerationWorker } from "@/lib/pets/generation/worker";
import { DAY, LEASE_MS, readGenerationClientIp, moscowDay, type GenerationJob } from "@/lib/pets/generation/model";
import type { GenerationStore, GenerationTransaction } from "@/lib/pets/generation/store";
beforeEach(() => {
  vi.stubEnv("PET_GENERATION_DAILY_IP_LIMIT", "10");
  vi.stubEnv("PET_GENERATION_DAILY_GLOBAL_LIMIT", "200");
});

class MemoryStore implements GenerationStore {
  jobs = new Map<string, GenerationJob>();
  ledger = new Map<string, { value: string; expiresAt: number }>();
  artifacts = new Map<string, { bytes: Buffer; expiresAt: number }>();
  private pending: Promise<unknown> = Promise.resolve();
  transaction<T>(operation: (tx: GenerationTransaction) => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      const jobs = structuredClone(this.jobs);
      const ledger = structuredClone(this.ledger);
      const artifacts = new Map(this.artifacts);
      const tx: GenerationTransaction = {
        listTakenSlugs: async () => [],
        saveSubmission: async () => { throw new Error("Submission is outside this admission fixture"); },
        getJob: async (id) => jobs.get(id) ?? null,
        getJobs: async ids => {
          const result = new Map<string, GenerationJob>();
          for (const id of ids) {const job = jobs.get(id); if (job) result.set(id, job);}
          return result;
        },
        putJob: async (job) => { jobs.set(job.id, structuredClone(job)); },
        getLedger: async (key, now) => { const row = ledger.get(key); return row && row.expiresAt > now ? row.value : null; },
        putLedger: async (key, value, expiresAt) => { ledger.set(key, { value, expiresAt }); },
        getArtifact: async (id, kind, now) => { const row = artifacts.get(id + ":" + kind); return row && row.expiresAt > now ? row.bytes : null; },
        hasArtifact: async (id,kind,now) => {const row=artifacts.get(id+":"+kind);return Boolean(row&&row.expiresAt>now);},
        setArtifactExpiry: async (id,kinds,expiresAt) => {for(const kind of kinds){const key=id+":"+kind,row=artifacts.get(key);if(row)artifacts.set(key,{...row,expiresAt});}},
        deleteArtifacts: async id => {for(const key of artifacts.keys())if(key.startsWith(id+":"))artifacts.delete(key);},
        putArtifact: async (id, kind, bytes, expiresAt) => { artifacts.set(id + ":" + kind, { bytes, expiresAt }); },
      };
      const value = await operation(tx);
      this.jobs = jobs; this.ledger = ledger; this.artifacts = artifacts;
      return value;
    });
    this.pending = result.catch(() => undefined);
    return result;
  }
  async readJob(id: string) { return this.jobs.get(id) ?? null; }
  async readArtifact(id: string, kind: string, now: number) {
    const row = this.artifacts.get(id + ":" + kind);
    return row && row.expiresAt > now ? row.bytes : null;
  }
  async cleanup(now: number) {
    for (const [id, job] of this.jobs) if (job.expiresAt <= now) this.jobs.delete(id);
    for (const [id, row] of this.artifacts) if (row.expiresAt <= now) this.artifacts.delete(id);
    for (const [id, row] of this.ledger) if (row.expiresAt <= now) this.ledger.delete(id);
  }
}

function fixture() {
  const store = new MemoryStore();
  const config = { now: Date.parse("2026-10-09T10:00:00Z"), enabled: true };
  let count = 0;
  const service = createGenerationService(store, { now: () => config.now, enabled: () => config.enabled, secret: () => "test-secret-at-least-32-characters-long", createId: () => (++count).toString(16).padStart(64, "0") });
  const input = () => ({ requestId: randomUUID(), prompt: "A small fox", displayName: "Fox" });
  return { store, service, config, input };
}

afterEach(() => vi.unstubAllEnvs());

describe("pet generation admission and privacy", () => {
  it("serializes concurrent idempotent requests without charging twice or leaking input", async () => {
    const f = fixture(); const input = f.input();
    const results = await Promise.all(Array.from({ length: 12 }, () => f.service.generate(input, "203.0.113.1")));
    expect(new Set(results.map((x) => x.generationId)).size).toBe(1);
    expect(f.store.jobs.size).toBe(1);
    expect([...f.store.ledger.values()].filter((x) => x.value === "1")).toHaveLength(2);
    expect(JSON.stringify(results)).not.toContain(input.prompt);
    expect(JSON.stringify([...f.store.ledger])).not.toContain("203.0.113.1");
    expect(JSON.stringify([...f.store.ledger])).not.toContain(input.prompt);
    await expect(f.service.generate({ ...input, prompt: "A different pet" }, "203.0.113.1")).rejects.toMatchObject({ code: "request_id_conflict" });
  });
  it("admits only the last two of ten daily IP attempts under concurrent requests", async () => {
    const f = fixture();
    for (let i = 0; i < 8; i += 1) {
      await f.service.generate(f.input(), "203.0.113.1");
      const job = await f.service.claim("worker");
      await f.service.fail(job!, "provider_rejected");
    }
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => f.service.generate(f.input(), "203.0.113.1")));
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(2);
    expect(results.filter((x) => x.status === "rejected").map(x => x.reason)).toEqual(
      Array.from({ length: 6 }, () => expect.objectContaining({ code: "rate_limited", limitScope: "ip" })),
    );
    expect(f.store.jobs.size).toBe(10);
  });
  it("rejects task 201 globally and resets at Moscow midnight", async () => {
    const f = fixture();
    for (let i = 0; i < 200; i += 1) {
      await f.service.generate(f.input(), "203.0.113." + (i + 1));
      const job = await f.service.claim("worker");
      expect(job).not.toBeNull();
      await f.service.fail(job!, "provider_rejected");
    }
    await expect(f.service.generate(f.input(), "198.51.100.1")).rejects.toMatchObject({ code: "rate_limited", limitScope: "global", retryAt: "2026-10-09T21:00:00.000Z" });
    f.config.now = Date.parse("2026-10-09T21:00:00Z");
    await expect(f.service.generate(f.input(), "198.51.100.1")).resolves.toMatchObject({ status: "queued" });
    expect(moscowDay(f.config.now)).toBe("2026-10-10");
  });
  it("keeps queue capacity occupied while waiting and expires work only at its storage deadline", async () => {
    vi.stubEnv("PET_GENERATION_QUEUE_LIMIT", "5");
    const f = fixture(); let id = "";
    for (let i = 0; i < 5; i += 1) id = (await f.service.generate(f.input(), "203.0.113." + (i + 1))).generationId;
    await expect(f.service.generate(f.input(), "198.51.100.1")).rejects.toMatchObject({ code: "queue_full" });
    f.config.now += 2 * 60 * 60_000;
    expect((await f.service.get(id)).status).toBe("queued");
    await expect(f.service.generate(f.input(), "198.51.100.1")).rejects.toMatchObject({ code: "queue_full" });
    f.config.now += DAY - 2 * 60 * 60_000;
    expect(await f.service.claim("worker")).toBeNull();
    await expect(f.service.get(id)).rejects.toMatchObject({code: "generation_expired"});
  });
  it("requires a trusted proxy IP and rejects arbitrary forwarded chains", async () => {
    const f = fixture();
    expect(readGenerationClientIp(new Headers({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "1.2.3.4" }))).toBeNull();
    expect(readGenerationClientIp(new Headers({ "x-pets-client-ip": "1.2.3.4,5.6.7.8" }))).toBeNull();
    expect(readGenerationClientIp(new Headers({ "x-pets-client-ip": "2001:db8::1" }))).toBe("2001:db8::1");
    await expect(f.service.generate(f.input(), null)).rejects.toMatchObject({ code: "client_ip_unavailable" });
    expect(f.store.jobs.size).toBe(0);
  });
  it("disables new work but preserves existing results and cleanup", async () => {
    const f = fixture(); const input = f.input(); const accepted = await f.service.generate(input, "203.0.113.1");
    f.config.enabled = false;
    await expect(f.service.generate(f.input(), "203.0.113.1")).rejects.toMatchObject({ code: "generation_disabled" });
    expect(await f.service.claim("worker")).toBeNull();
    expect((await f.service.generate(input, "203.0.113.1")).generationId).toBe(accepted.generationId);
    await expect(f.service.get(accepted.generationId)).resolves.toMatchObject({ status: "queued" });
    f.config.now += DAY;
    await f.store.cleanup(f.config.now);
    await expect(f.service.get(accepted.generationId)).rejects.toMatchObject({ code: "not_found" });
    await expect(f.service.generate(input, "203.0.113.1")).rejects.toMatchObject({ code: "generation_expired" });
    expect([...f.store.ledger.keys()].some((x) => x.startsWith("request:"))).toBe(true);
  });
});

describe("single paid attempt and worker recovery", () => {
  it("only one worker can own a generation", async () => {
    const f = fixture(); await f.service.generate(f.input(), "203.0.113.1");
    const jobs = await Promise.all([f.service.claim("a"), f.service.claim("b")]);
    expect(jobs.filter(Boolean)).toHaveLength(1);
  });
  it("does not replay a timeout or an abandoned generating task", async () => {
    const f = fixture(); const accepted = await f.service.generate(f.input(), "203.0.113.1");
    const generate = vi.fn().mockRejectedValue(new Error("timeout"));
    const worker = createGenerationWorker({ service: f.service, store: f.store, generate, now: () => f.config.now });
    expect(await worker("a")).toBe("failed");
    expect(await worker("b")).toBe("idle");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await f.service.get(accepted.generationId)).toMatchObject({ status: "failed", error: { code: "outcome_unknown" } });
    await expect(f.service.generate(f.input(), "203.0.113.1")).rejects.toMatchObject({ code: "generation_paused" });
  });
  it("resumes packaging a saved image after restart without regenerating it", async () => {
    const f = fixture(); const accepted = await f.service.generate(f.input(), "203.0.113.1");
    // This worker handles pre-row single-atlas records, whose default pipeline is 1.
    const legacy = f.store.jobs.get(accepted.generationId)!;
    f.store.jobs.set(accepted.generationId, { ...legacy, pipelineVersion: 1 });
    const generate = vi.fn().mockResolvedValue({ bytes: Buffer.from("saved-image"), generationMs: 10 });
    const build = vi.fn().mockRejectedValueOnce(new Error("process crash")).mockResolvedValueOnce({ "pet.zip": Buffer.from("zip") });
    const worker = createGenerationWorker({ service: f.service, store: f.store, generate, build, now: () => f.config.now });
    await expect(worker("first")).rejects.toThrow("process crash");
    f.config.now += LEASE_MS + 1;
    expect(await worker("second")).toBe("completed");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(build).toHaveBeenCalledTimes(2);
    expect(await f.service.get(accepted.generationId)).toMatchObject({ status: "completed", pet: { spriteVersionNumber: 2 } });
    expect((await f.store.readJob(accepted.generationId))?.prompt).toBe("");
  });
});
