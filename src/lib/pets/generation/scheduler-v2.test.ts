import {afterEach, describe, expect, it, vi} from "vitest";
import {parallelFixture} from "./parallel-fixture.test-utils";

afterEach(() => vi.unstubAllEnvs());

describe("shared scheduler", () => {
  it("claims two different jobs and leaves the third waiting", async () => {
    const f = await parallelFixture();
    const [a, b, c] = await Promise.all([f.service.claim("a"), f.service.claim("b"), f.service.claim("c")]);
    expect([a?.id, b?.id, c]).toEqual([f.a.generationId, f.b.generationId, null]);
    expect(a?.workerLeaseId).toBeTruthy();
    expect(b?.workerLeaseId).not.toBe(a?.workerLeaseId);
  });
  it("yields to older waiting jobs without changing identity, attempt journal or expiry", async () => {
    const f = await parallelFixture();
    const a = (await f.service.claim("same-process"))!;
    const before = structuredClone(a);
    await f.service.yield(a, f.clock.now + 5000);
    expect((await f.service.claim("next"))?.id).toBe(f.b.generationId);
    expect((await f.service.claim("third"))?.id).toBe(f.c.generationId);
    const saved = (await f.store.readJob(a.id))!;
    expect(saved).toMatchObject({id: before.id, expiresAt: before.expiresAt, createdAt: before.createdAt, animationRepair: before.animationRepair});
    await expect(f.service.heartbeat(a)).rejects.toMatchObject({code: "stale_worker"});
  });
  it("does not clear a different active lease when one job fails", async () => {
    const f = await parallelFixture();
    const a = (await f.service.claim("a"))!, b = (await f.service.claim("b"))!;
    await f.service.beginStage(a, "base");
    await f.service.saveStage(a, "base", Buffer.from("base"), {generationMs: 1});
    await f.service.fail(a, "provider_rejected");
    await expect(f.service.heartbeat(b)).resolves.toMatchObject({id: b.id});
    expect((await f.service.claim("c"))?.id).toBe(f.c.generationId);
  });
  it("preserves the original retention deadline when the claim read crosses it", async () => {
    const f = await parallelFixture();
    f.clock.now = (await f.store.readJob(f.a.generationId))!.expiresAt - 100;
    const next = await f.admit();
    const transaction = f.store.transaction.bind(f.store);
    vi.spyOn(f.store, "transaction").mockImplementationOnce(operation => transaction(tx => operation({...tx,
      getJob: async id => {const job = await tx.getJob(id); if (id === f.a.generationId) f.clock.now += 200; return job;},
    })));
    expect((await f.service.claim("after-boundary"))?.id).toBe(next.generationId);
    expect(await f.store.readJob(f.a.generationId)).toMatchObject({status: "queued"});
  });
  it("resumes started work after thirty minutes without resetting expiry or accepting an old lease", async () => {
    const f = await parallelFixture(), a = (await f.service.claim("same-owner"))!;
    await f.service.yield(a);
    f.clock.now += 31 * 60_000;
    for (const id of [f.b.generationId, f.c.generationId]) {
      const peer = (await f.service.claim("waiting-peer"))!;
      expect(peer.id).toBe(id);
      await f.service.fail(peer, "provider_rejected");
    }
    const resumed = (await f.service.claim("same-owner"))!;
    expect(resumed.id).toBe(a.id);
    expect(resumed.expiresAt).toBe(a.expiresAt);
    expect(resumed.workerLeaseId).not.toBe(a.workerLeaseId);
    await expect(f.service.heartbeat(a)).rejects.toMatchObject({code: "stale_worker"});
  });
});
